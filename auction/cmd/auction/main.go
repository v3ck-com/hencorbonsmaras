package main

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"hencor/auction/internal/server"
	"hencor/auction/web"
)

func main() {
	if err := run(); err != nil {
		slog.Error("auction stopped", "error", err)
		os.Exit(1)
	}
}
func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	cfg := server.Config{Origin: os.Getenv("APP_ORIGIN"), OperatorPassword: os.Getenv("OPERATOR_PASSWORD"), BroadcastPassword: os.Getenv("BROADCAST_PASSWORD"), LiveKitURL: os.Getenv("LIVEKIT_URL"), LiveKitKey: os.Getenv("LIVEKIT_API_KEY"), LiveKitSecret: os.Getenv("LIVEKIT_API_SECRET"), AssetsDir: env("ASSETS_DIR", "../assets")}
	if err := cfg.Validate(); err != nil {
		return err
	}
	db, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		return err
	}
	defer db.Close()
	initCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	store, err := server.NewStore(initCtx, db)
	if err != nil {
		return err
	}
	srv := &http.Server{Addr: env("LISTEN_ADDR", ":8080"), Handler: server.New(cfg, store, web.Files), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second, BaseContext: func(net.Listener) context.Context { return ctx }}
	// Cancel SSE streams on shutdown as well as normal client disconnect.
	done := make(chan error, 1)
	go func() { slog.Info("media rehearsal listening", "address", srv.Addr); done <- srv.ListenAndServe() }()
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
	}
	shutdown, c := context.WithTimeout(context.Background(), 5*time.Second)
	defer c()
	if err = srv.Shutdown(shutdown); err != nil {
		srv.Close()
	}
	return nil
}
func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
