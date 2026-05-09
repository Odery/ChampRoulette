// Package main is the entry point for the ChampRoulette server.
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Odery/ChampRoulette/internal/champions"
	"github.com/Odery/ChampRoulette/internal/web"
)

func main() {
	slog.SetDefault(buildLogger())

	port := getEnv("PORT", "8080")
	staticDir := getEnv("STATIC_DIR", "./static")

	loadCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	slog.Info("loading champions from data dragon")
	pool, err := champions.Load(loadCtx)
	if err != nil {
		slog.Error("failed to load champions", "err", err)
		os.Exit(1)
	}
	slog.Info("champions loaded", "count", len(pool.Champions), "version", pool.Version)

	app := web.NewApp(pool, staticDir)

	go func() {
		slog.Info("server listening", "addr", ":"+port)
		if err := app.Listen(":" + port); err != nil {
			slog.Error("server stopped", "err", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	sig := <-stop
	slog.Info("shutdown signal received", "signal", sig.String())

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	if err := app.ShutdownWithContext(shutdownCtx); err != nil {
		slog.Error("graceful shutdown failed", "err", err)
		os.Exit(1)
	}
	slog.Info("bye")
}

func buildLogger() *slog.Logger {
	level := slog.LevelInfo
	switch os.Getenv("LOG_LEVEL") {
	case "DEBUG", "debug":
		level = slog.LevelDebug
	case "WARN", "warn":
		level = slog.LevelWarn
	case "ERROR", "error":
		level = slog.LevelError
	}
	return slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: level}))
}

func getEnv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
