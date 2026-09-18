package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func testConfig() Config {
	return Config{Origin: "http://localhost:8097", OperatorPassword: strings.Repeat("a", 24), BroadcastPassword: strings.Repeat("b", 24), LiveKitURL: "ws://localhost:7880", LiveKitKey: "test-key", LiveKitSecret: strings.Repeat("s", 32)}
}
func TestConfig(t *testing.T) {
	c := testConfig()
	if err := c.Validate(); err != nil {
		t.Fatal(err)
	}
	c.Origin = "http://auction.hencorbonsmaras.co.za"
	if c.Validate() == nil {
		t.Fatal("public HTTP accepted")
	}
	c = testConfig()
	c.BroadcastPassword = c.OperatorPassword
	if c.Validate() == nil {
		t.Fatal("shared password accepted")
	}
	c = testConfig()
	c.Origin = "https://auction.hencorbonsmaras.co.za"
	if c.Validate() == nil {
		t.Fatal("insecure media accepted")
	}
}
func TestMediaGrants(t *testing.T) {
	for _, publish := range []bool{false, true} {
		signed, err := mediaJWT("key", strings.Repeat("s", 32), "identity", publish)
		if err != nil {
			t.Fatal(err)
		}
		token, err := jwt.Parse(signed, func(token *jwt.Token) (any, error) { return []byte(strings.Repeat("s", 32)), nil }, jwt.WithValidMethods([]string{"HS256"}))
		if err != nil {
			t.Fatal(err)
		}
		claims := token.Claims.(jwt.MapClaims)
		video := claims["video"].(map[string]any)
		if video["canPublish"] != publish || video["canSubscribe"] == publish || video["canPublishData"] != false || video["room"] != "hencor-auction" || video["roomAdmin"] != nil {
			t.Fatalf("bad grants: %v", video)
		}
		if publish && len(video["canPublishSources"].([]any)) != 2 {
			t.Fatal("publisher sources missing")
		}
	}
}
func TestCatalogue(t *testing.T) {
	var lots []Lot
	if err := json.Unmarshal(catalogue, &lots); err != nil {
		t.Fatal(err)
	}
	if len(lots) != 25 {
		t.Fatal("expected 25 lots")
	}
	for i, l := range lots {
		if l.Number != i+1 || len(l.YouTubeID) != 11 || !strings.HasSuffix(l.Image, fmt.Sprintf("lot-%02d.png", i+1)) {
			t.Fatalf("bad lot: %+v", l)
		}
	}
}

func TestIntegration(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL for isolated PostgreSQL integration tests")
	}
	ctx := context.Background()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	schema := "test_" + randomToken()[:12]
	if _, err = root.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer root.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	db, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store, err := NewStore(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	config := testConfig()
	config.Validate()
	handler := New(config, store, fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("rehearsal")}, "static/test.css": &fstest.MapFile{Data: []byte("body{}")}})
	request := func(method, path, body, role string, origin bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if origin {
			req.Header.Set("Origin", config.Origin)
		}
		if role != "" {
			req.AddCookie(&http.Cookie{Name: "auction_session", Value: role})
		}
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}
	t.Run("CSRF and roles", func(t *testing.T) {
		if r := request("POST", "/api/session", `{"role":"operator","password":"`+config.OperatorPassword+`"}`, "", false); r.Code != 403 {
			t.Fatal(r.Code)
		}
		if r := request("POST", "/api/control", `{}`, "", true); r.Code != 401 {
			t.Fatal(r.Code)
		}
		if r := request("POST", "/api/token", `{"publish":true}`, "", true); r.Code != 401 {
			t.Fatal(r.Code)
		}
		if r := request("POST", "/api/token", `{"publish":false}`, "", true); r.Code != 200 {
			t.Fatal(r.Code, r.Body.String())
		}
	})
	login := func(role, password string) string {
		t.Helper()
		rec := request("POST", "/api/session", `{"role":"`+role+`","password":"`+password+`"}`, "", true)
		if rec.Code != 200 {
			t.Fatal(rec.Code, rec.Body.String())
		}
		cookies := rec.Result().Cookies()
		if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode {
			t.Fatal("unsafe cookie")
		}
		return cookies[0].Value
	}
	operator := login("operator", config.OperatorPassword)
	broadcaster := login("broadcaster", config.BroadcastPassword)
	t.Run("privilege boundaries", func(t *testing.T) {
		if r := request("POST", "/api/control", `{}`, broadcaster, true); r.Code != 401 {
			t.Fatal(r.Code)
		}
		if r := request("POST", "/api/token", `{"publish":true}`, operator, true); r.Code != 401 {
			t.Fatal(r.Code)
		}
		if r := request("POST", "/api/token", `{"publish":true}`, broadcaster, true); r.Code != 200 {
			t.Fatal(r.Code)
		}
	})
	t.Run("validation and atomic updates", func(t *testing.T) {
		if r := request("POST", "/api/control", `{"revision":1,"lotNumber":99,"mode":"live"}`, operator, true); r.Code != 400 {
			t.Fatal(r.Code)
		}
		if r := request("POST", "/api/control", `{"revision":1,"lotNumber":2,"mode":"invalid"}`, operator, true); r.Code != 400 {
			t.Fatal(r.Code)
		}
		if r := request("POST", "/api/control", `{"revision":1,"lotNumber":2,"mode":"live"}`, operator, true); r.Code != 200 {
			t.Fatal(r.Code, r.Body.String())
		}
		if r := request("POST", "/api/control", `{"revision":1,"lotNumber":3,"mode":"recorded"}`, operator, true); r.Code != 409 {
			t.Fatal("stale change accepted", r.Code)
		}
		var wins atomic.Int32
		var wg sync.WaitGroup
		for i := 0; i < 8; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if _, err := store.Change(ctx, 2, 3, "audio", "test", "race"); err == nil {
					wins.Add(1)
				} else if err != ErrConflict {
					t.Error(err)
				}
			}()
		}
		wg.Wait()
		if wins.Load() != 1 {
			t.Fatal("concurrent changes accepted", wins.Load())
		}
		var audits int
		if err := db.QueryRow(ctx, `SELECT count(*) FROM media_audit`).Scan(&audits); err != nil || audits != 2 {
			t.Fatal("audit not atomic", audits, err)
		}
	})
	t.Run("degradation cannot restore or change lot", func(t *testing.T) {
		st, _ := store.State(ctx)
		st, err = store.Change(ctx, st.Revision, 4, "live", "operator", "test")
		if err != nil {
			t.Fatal(err)
		}
		st, err = store.Degrade(ctx, "broadcaster")
		if err != nil || st.Mode != "audio" || st.LotNumber != 4 {
			t.Fatal(st, err)
		}
		rev := st.Revision
		st, err = store.Degrade(ctx, "broadcaster")
		if err != nil || st.Revision != rev {
			t.Fatal("repeated degradation changed state")
		}
		other, err := NewStore(ctx, db)
		if err != nil {
			t.Fatal(err)
		}
		st, _ = other.State(ctx)
		if st.LotNumber != 4 || st.Mode != "audio" {
			t.Fatal("restart lost state")
		}
	})
	t.Run("SSE sends initial state", func(t *testing.T) {
		ts := httptest.NewServer(handler)
		defer ts.Close()
		client := http.Client{Timeout: 3 * time.Second}
		resp, err := client.Get(ts.URL + "/api/events")
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		buf := make([]byte, 100)
		n, err := io.ReadAtLeast(resp.Body, buf, 50)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Contains(buf[:n], []byte("event: state")) {
			t.Fatal("missing snapshot")
		}
	})
	t.Run("session revocation", func(t *testing.T) {
		if r := request("DELETE", "/api/session", "", operator, true); r.Code != 200 {
			t.Fatal(r.Code)
		}
		if r := request("POST", "/api/control", `{}`, operator, true); r.Code != 401 {
			t.Fatal("revoked session accepted")
		}
	})
}
