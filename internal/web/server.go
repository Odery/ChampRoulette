// Package web wires up the HTTP layer: a Fiber app that exposes a small
// JSON API for the frontend and serves the static asset directory.
//
// State is intentionally global and singular: one tournament at a time,
// guarded by a mutex. This is the simplest possible model and matches
// the deployment shape (one Docker container, run with friends).
package web

import (
	"errors"
	"log/slog"
	"sync"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"

	"github.com/Odery/ChampRoulette/internal/champions"
	"github.com/Odery/ChampRoulette/internal/tournament"
)

// Server holds the singleton tournament and the engine that mutates it.
type Server struct {
	mu     sync.Mutex
	state  *tournament.State
	engine *tournament.Engine
}

// NewApp constructs the Fiber app: API routes first (so they win against
// the static handler), then static asset serving from staticDir.
func NewApp(pool *champions.Pool, staticDir string) *fiber.App {
	app := fiber.New(fiber.Config{
		AppName:               "ChampRoulette",
		DisableStartupMessage: true,
	})
	app.Use(recover.New())

	s := &Server{engine: tournament.NewEngine(pool)}

	api := app.Group("/api")
	api.Get("/state", s.getState)
	api.Post("/tournament", s.createTournament)
	api.Post("/round/result", s.reportResult)
	api.Post("/reset", s.resetTournament)

	app.Static("/", staticDir, fiber.Static{Browse: false})

	return app
}

type startReq struct {
	Players    []string `json:"players"`
	Sequential bool     `json:"sequential"`
}

type resultReq struct {
	MatchID string `json:"matchId"`
	Winner  string `json:"winner"`
}

type errResp struct {
	Error string `json:"error"`
}

func (s *Server) getState(c *fiber.Ctx) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return c.JSON(fiber.Map{"state": s.state})
}

func (s *Server) createTournament(c *fiber.Ctx) error {
	var req startReq
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(errResp{Error: "invalid body"})
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	st, err := s.engine.New(req.Players, req.Sequential)
	if err != nil {
		slog.Warn("create tournament rejected", "err", err, "submitted", len(req.Players))
		return c.Status(fiber.StatusBadRequest).JSON(errResp{Error: err.Error()})
	}
	s.state = st
	slog.Info("tournament created",
		"players", len(st.Players),
		"rounds", len(st.Rounds),
		"sequential", st.Sequential,
		"bracketSize", st.BracketSize,
	)
	return c.JSON(fiber.Map{"state": st})
}

func (s *Server) reportResult(c *fiber.Ctx) error {
	var req resultReq
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(errResp{Error: "invalid body"})
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state == nil {
		return c.Status(fiber.StatusBadRequest).JSON(errResp{Error: "no active tournament"})
	}
	if err := s.engine.Report(s.state, req.MatchID, req.Winner); err != nil {
		slog.Warn("report result rejected", "err", err, "match", req.MatchID, "winner", req.Winner)
		return c.Status(httpCodeFor(err)).JSON(errResp{Error: err.Error()})
	}
	slog.Info("match reported", "match", req.MatchID, "winner", req.Winner, "done", s.state.Done)
	return c.JSON(fiber.Map{"state": s.state})
}

func (s *Server) resetTournament(c *fiber.Ctx) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state = nil
	slog.Info("tournament reset")
	return c.JSON(fiber.Map{"state": nil})
}

func httpCodeFor(err error) int {
	switch {
	case errors.Is(err, tournament.ErrMatchNotFound):
		return fiber.StatusNotFound
	default:
		return fiber.StatusBadRequest
	}
}
