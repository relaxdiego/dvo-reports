// Command server runs the dvo-reports backend as an ordinary HTTP server.
//
// One binary, one entrypoint. It runs the same way on a laptop, in a
// container, on DigitalOcean App Platform, and on AWS Lambda behind the
// Lambda Web Adapter. See docs/deploy.md.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/relaxdiego/dvo-reports/backend/internal/api"
	"github.com/relaxdiego/dvo-reports/backend/internal/upstream"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	addr := ":" + envOr("PORT", "8080")
	srv := &http.Server{
		Addr: addr,
		Handler: api.New(api.Config{
			Upstream:       pickUpstream(log),
			AllowedOrigins: splitList(envOr("ALLOWED_ORIGINS", "http://localhost:5173")),
			Log:            log,
		}),
		ReadHeaderTimeout: 5 * time.Second,
		// Generous: a report carries photos over a phone connection.
		ReadTimeout:  60 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Info("listening", "addr", addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("server stopped", "err", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	log.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Error("shutdown failed", "err", err)
	}
}

// pickUpstream returns the real city client unless UPSTREAM=echo asks for
// the stand-in. The default is the real one on purpose: Echo invents
// reference numbers, and a citizen who gets one believes a report was filed
// when it was not.
func pickUpstream(log *slog.Logger) upstream.Client {
	if envOr("UPSTREAM", "city") == "echo" {
		log.Warn("using the echo upstream: reports are NOT sent to the city and reference numbers are invented")
		return &upstream.Echo{}
	}
	return &upstream.City{BaseURL: envOr("UPSTREAM_BASE_URL", upstream.DefaultBaseURL)}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// splitList reads a comma-separated env var, e.g. ALLOWED_ORIGINS.
func splitList(s string) []string {
	var out []string
	for _, part := range strings.Split(s, ",") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}
