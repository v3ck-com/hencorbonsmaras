package server

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func randomToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func hashToken(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }
func equalSecret(a, b string) bool {
	x, y := sha256.Sum256([]byte(a)), sha256.Sum256([]byte(b))
	return subtle.ConstantTimeCompare(x[:], y[:]) == 1
}

type limiter struct {
	sync.Mutex
	entries map[string]bucket
}
type bucket struct {
	start time.Time
	count int
}

func (l *limiter) allow(key string, max int) bool {
	l.Lock()
	defer l.Unlock()
	now := time.Now()
	if l.entries == nil {
		l.entries = map[string]bucket{}
	}
	for k, v := range l.entries {
		if now.Sub(v.start) > time.Minute {
			delete(l.entries, k)
		}
	}
	b := l.entries[key]
	if b.start.IsZero() {
		b.start = now
	}
	b.count++
	l.entries[key] = b
	return b.count <= max
}
func remoteKey(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (s *Server) role(r *http.Request) string {
	c, err := r.Cookie("auction_session")
	if err != nil {
		return ""
	}
	var role string
	err = s.store.DB.QueryRow(r.Context(), `SELECT role FROM role_sessions WHERE token_hash=$1 AND expires_at>now()`, hashToken(c.Value)).Scan(&role)
	if err != nil {
		return ""
	}
	return role
}
func (s *Server) require(w http.ResponseWriter, r *http.Request, role string) bool {
	if s.role(r) != role {
		problem(w, http.StatusUnauthorized, "Please sign in as "+role)
		return false
	}
	return true
}

func (s *Server) session(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		respond(w, 200, map[string]string{"role": s.role(r)})
		return
	}
	if r.Method == "DELETE" {
		if c, err := r.Cookie("auction_session"); err == nil {
			s.store.DB.Exec(r.Context(), `DELETE FROM role_sessions WHERE token_hash=$1`, hashToken(c.Value))
		}
		http.SetCookie(w, &http.Cookie{Name: "auction_session", Path: "/", Value: "", MaxAge: -1, HttpOnly: true, Secure: s.cfg.Secure, SameSite: http.SameSiteStrictMode})
		respond(w, 200, map[string]bool{"ok": true})
		return
	}
	if !s.limits.allow("login:"+remoteKey(r), 20) {
		problem(w, 429, "Too many attempts. Try again in a minute.")
		return
	}
	var input struct {
		Role     string `json:"role"`
		Password string `json:"password"`
	}
	if !decode(w, r, &input) {
		return
	}
	expected := ""
	switch input.Role {
	case "operator":
		expected = s.cfg.OperatorPassword
	case "broadcaster":
		expected = s.cfg.BroadcastPassword
	}
	if expected == "" || !equalSecret(expected, input.Password) {
		problem(w, 401, "Incorrect role or password")
		return
	}
	token := randomToken()
	tx, err := s.store.DB.Begin(r.Context())
	if err != nil {
		problem(w, 500, "Session unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	if c, e := r.Cookie("auction_session"); e == nil {
		_, err = tx.Exec(r.Context(), `DELETE FROM role_sessions WHERE token_hash=$1`, hashToken(c.Value))
		if err != nil {
			problem(w, 500, "Session unavailable")
			return
		}
	}
	_, err = tx.Exec(r.Context(), `DELETE FROM role_sessions WHERE expires_at<now()`)
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO role_sessions VALUES($1,$2,now()+interval '12 hours')`, hashToken(token), input.Role)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		problem(w, 500, "Session unavailable")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "auction_session", Value: token, Path: "/", MaxAge: 43200, HttpOnly: true, Secure: s.cfg.Secure, SameSite: http.SameSiteStrictMode})
	respond(w, 200, map[string]string{"role": input.Role})
}

func mediaJWT(key, secret, identity string, publish bool) (string, error) {
	video := map[string]any{"roomJoin": true, "room": "hencor-auction", "canPublish": publish, "canSubscribe": !publish, "canPublishData": false}
	if publish {
		video["canPublishSources"] = []string{"camera", "microphone"}
	}
	now := time.Now()
	return jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"iss": key, "sub": identity, "nbf": now.Add(-5 * time.Second).Unix(), "exp": now.Add(5 * time.Minute).Unix(), "video": video}).SignedString([]byte(secret))
}

func (s *Server) token(w http.ResponseWriter, r *http.Request) {
	if !s.limits.allow("token:"+remoteKey(r), 180) {
		problem(w, 429, "Too many connection attempts")
		return
	}
	var in struct {
		Publish bool `json:"publish"`
	}
	if !decode(w, r, &in) {
		return
	}
	identity := "viewer-" + randomToken()[:16]
	if in.Publish {
		if !s.require(w, r, "broadcaster") {
			return
		}
		identity = "venue-phone"
	}
	token, err := mediaJWT(s.cfg.LiveKitKey, s.cfg.LiveKitSecret, identity, in.Publish)
	if err != nil {
		problem(w, 500, "Unable to create media session")
		return
	}
	respond(w, 200, map[string]string{"token": token, "url": s.cfg.LiveKitURL})
}
