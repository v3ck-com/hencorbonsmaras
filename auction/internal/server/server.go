package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Config struct {
	Origin, OperatorPassword, BroadcastPassword, LiveKitURL, LiveKitKey, LiveKitSecret, AssetsDir string
	Secure                                                                                        bool
}

func (c *Config) Validate() error {
	for _, secret := range []string{c.OperatorPassword, c.BroadcastPassword, c.LiveKitSecret} {
		if strings.Contains(secret, "CHANGE_ME") {
			return errors.New("replace example credentials with independent random secrets")
		}
	}
	u, err := url.Parse(c.Origin)
	if err != nil || u.Host == "" || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return errors.New("APP_ORIGIN must be an origin without a trailing slash")
	}
	c.Secure = u.Scheme == "https"
	if !c.Secure && !(u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1")) {
		return errors.New("HTTPS is required except on localhost")
	}
	if len(c.OperatorPassword) < 16 || len(c.BroadcastPassword) < 16 || equalSecret(c.OperatorPassword, c.BroadcastPassword) {
		return errors.New("set distinct OPERATOR_PASSWORD and BROADCAST_PASSWORD of at least 16 characters")
	}
	media, e := url.Parse(c.LiveKitURL)
	if e != nil || media.Host == "" || (media.Scheme != "wss" && media.Scheme != "ws") || (c.Secure && media.Scheme != "wss") {
		return errors.New("LIVEKIT_URL must be a WebSocket URL (wss for production)")
	}
	if c.LiveKitKey == "" || len(c.LiveKitSecret) < 32 {
		return errors.New("set LIVEKIT_API_KEY and LIVEKIT_API_SECRET (32+ characters)")
	}
	return nil
}

type Server struct {
	cfg    Config
	store  *Store
	limits limiter
}

func New(cfg Config, store *Store, web fs.FS) http.Handler {
	s := &Server{cfg: cfg, store: store}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if store.DB.Ping(ctx) != nil {
			problem(w, 503, "Database unavailable")
			return
		}
		respond(w, 200, map[string]string{"status": "ok", "stage": "media-rehearsal"})
	})
	mux.HandleFunc("GET /api/state", s.state)
	mux.HandleFunc("GET /api/events", s.events)
	mux.HandleFunc("GET /api/session", s.session)
	mux.HandleFunc("POST /api/session", s.session)
	mux.HandleFunc("DELETE /api/session", s.session)
	mux.HandleFunc("POST /api/token", s.token)
	mux.HandleFunc("POST /api/control", s.control)
	mux.HandleFunc("POST /api/degrade", s.degrade)
	static, _ := fs.Sub(web, "static")
	mux.Handle("GET /static/", http.StripPrefix("/static/", http.FileServerFS(static)))
	// Serve only the public asset classes needed by the catalogue.
	assets := http.StripPrefix("/catalogue/", http.FileServer(http.Dir(cfg.AssetsDir)))
	mux.HandleFunc("GET /catalogue/", func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/catalogue/")
		if strings.Contains(p, "..") || strings.HasSuffix(p, "/") || !(p == "logo.png" || strings.HasPrefix(p, "bull-images/") || strings.HasPrefix(p, "katalogus-tables/")) {
			http.NotFound(w, r)
			return
		}
		assets.ServeHTTP(w, r)
	})
	shell, _ := fs.ReadFile(web, "index.html")
	for _, path := range []string{"/{$}", "/operator", "/broadcast"} {
		mux.HandleFunc("GET "+path, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write(shell)
		})
	}
	mediaOrigin := strings.Replace(strings.Replace(cfg.LiveKitURL, "wss://", "https://", 1), "ws://", "http://", 1)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Permissions-Policy", "camera=(self), microphone=(self), display-capture=()")
		w.Header().Set("Content-Security-Policy", fmt.Sprintf("default-src 'self'; script-src 'self' https://www.youtube.com https://s.ytimg.com; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self' %s %s; frame-src https://www.youtube.com https://www.youtube-nocookie.com; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'", cfg.LiveKitURL, mediaOrigin))
		if cfg.Secure {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000")
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Cache-Control", "no-store")
		}
		if r.Method != "GET" && r.Method != "HEAD" && r.Header.Get("Origin") != cfg.Origin {
			problem(w, 403, "Request origin rejected")
			return
		}
		mux.ServeHTTP(w, r)
	})
}

func respond(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
func problem(w http.ResponseWriter, status int, message string) {
	respond(w, status, map[string]string{"error": message})
}
func decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		problem(w, 415, "JSON required")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if d.Decode(dst) != nil || d.Decode(&struct{}{}) != io.EOF {
		problem(w, 400, "Invalid request")
		return false
	}
	return true
}
func (s *Server) state(w http.ResponseWriter, r *http.Request) {
	st, err := s.store.State(r.Context())
	if err != nil {
		problem(w, 503, "Auction state unavailable")
		return
	}
	respond(w, 200, st)
}
func (s *Server) control(w http.ResponseWriter, r *http.Request) {
	if !s.require(w, r, "operator") {
		return
	}
	var in struct {
		Revision int64  `json:"revision"`
		Lot      int    `json:"lotNumber"`
		Mode     string `json:"mode"`
	}
	if !decode(w, r, &in) {
		return
	}
	st, err := s.store.Change(r.Context(), in.Revision, in.Lot, in.Mode, "operator", "control")
	s.changed(w, st, err)
}
func (s *Server) degrade(w http.ResponseWriter, r *http.Request) {
	if !s.require(w, r, "broadcaster") {
		return
	}
	st, err := s.store.Degrade(r.Context(), "broadcaster")
	s.changed(w, st, err)
}
func (s *Server) changed(w http.ResponseWriter, st State, err error) {
	switch {
	case errors.Is(err, ErrConflict):
		problem(w, 409, err.Error())
	case errors.Is(err, ErrInvalid):
		problem(w, 400, err.Error())
	case err != nil:
		slog.Error("state change failed", "error", err)
		problem(w, 503, "Unable to save state")
	default:
		respond(w, 200, st)
	}
}
func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	f, ok := w.(http.Flusher)
	if !ok {
		problem(w, 500, "Streaming unavailable")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("X-Accel-Buffering", "no")
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	var revision int64
	count := 0
	for {
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		st, err := s.store.State(ctx)
		cancel()
		if err != nil {
			return
		}
		// Bound writes so abandoned viewers cannot retain server goroutines forever.
		http.NewResponseController(w).SetWriteDeadline(time.Now().Add(5 * time.Second))
		if st.Revision != revision {
			data, _ := json.Marshal(st)
			if _, err = fmt.Fprintf(w, "event: state\ndata: %s\n\n", data); err != nil {
				return
			}
			revision = st.Revision
		}
		if count%3 == 0 {
			if _, err = fmt.Fprint(w, "event: heartbeat\ndata: {}\n\n"); err != nil {
				return
			}
		}
		f.Flush()
		count++
		select {
		case <-r.Context().Done():
			return
		case <-tick.C:
		}
	}
}
