// Package tournament implements single-elimination bracket logic with
// random byes, strict bracket advancement and champion uniqueness across
// the entire run.
//
// Mechanics:
//   - 2 to 5 players per tournament.
//   - The bracket is the next power of two ≥ player count.
//   - Empty slots become byes; bye pairs are picked at random and the
//     real player auto-advances.
//   - Each non-bye match drafts one champion per player. A champion is
//     never drafted twice in the same tournament.
//   - "Real tournament" pairings: winner of slot 2k always plays winner
//     of slot 2k+1 in the next round.
package tournament

import (
	"errors"
	"fmt"
	"math/rand/v2"
	"strings"

	"github.com/Odery/ChampRoulette/internal/champions"
)

// Bounds on tournament size.
const (
	MinPlayers = 2
	MaxPlayers = 5
)

// Sentinel errors for handler-level translation to HTTP codes.
var (
	ErrTooFewPlayers      = errors.New("need at least 2 players")
	ErrTooManyPlayers     = errors.New("at most 5 players")
	ErrDuplicateNames     = errors.New("player names must be unique")
	ErrAlreadyDone        = errors.New("tournament already complete")
	ErrMatchNotFound      = errors.New("match not found")
	ErrMatchAlreadyClosed = errors.New("match already completed")
	ErrInvalidWinner      = errors.New("winner must be one of the two players in the match")
	ErrChampPoolExhausted = errors.New("not enough unique champions remaining")
)

// Match is a single bracket node. A Bye match has only PlayerA, no
// champions, and is auto-completed when generated.
type Match struct {
	ID        string              `json:"id"`
	PlayerA   string              `json:"playerA"`
	PlayerB   string              `json:"playerB,omitempty"`
	ChampA    *champions.Champion `json:"champA,omitempty"`
	ChampB    *champions.Champion `json:"champB,omitempty"`
	IsBye     bool                `json:"isBye"`
	Winner    string              `json:"winner,omitempty"`
	Completed bool                `json:"completed"`
}

// Round groups the matches of a single bracket round.
type Round struct {
	Number  int      `json:"number"`
	Matches []*Match `json:"matches"`
}

// State is the full tournament state — what the API returns to the client.
// usedChamps stays server-side; the frontend only needs the per-match
// drafts and the Data Dragon version for icon URLs.
type State struct {
	Players    []string        `json:"players"`
	Rounds     []*Round        `json:"rounds"`
	Champion   string          `json:"champion,omitempty"`
	Done       bool            `json:"done"`
	Version    string          `json:"version"`
	usedChamps map[string]bool `json:"-"`
}

// Engine creates and mutates States. It is stateless aside from the
// shared champion pool and is safe to share; serialization of access to
// any individual State is the caller's responsibility.
type Engine struct {
	pool *champions.Pool
}

// NewEngine returns an Engine bound to the given champion pool.
func NewEngine(pool *champions.Pool) *Engine {
	return &Engine{pool: pool}
}

// New starts a fresh tournament with the given player names. Names are
// trimmed; empty entries are dropped before validation.
func (e *Engine) New(players []string) (*State, error) {
	cleaned, err := validatePlayers(players)
	if err != nil {
		return nil, err
	}
	s := &State{
		Players:    cleaned,
		Rounds:     []*Round{},
		Version:    e.pool.Version,
		usedChamps: map[string]bool{},
	}
	if err := e.startFirstRound(s); err != nil {
		return nil, err
	}
	return s, nil
}

// Report records the winner of a match. If that closes out the round,
// the next round is generated automatically (or the tournament ends).
func (e *Engine) Report(s *State, matchID, winner string) error {
	if s.Done {
		return ErrAlreadyDone
	}
	cur := s.Rounds[len(s.Rounds)-1]
	var m *Match
	for _, mm := range cur.Matches {
		if mm.ID == matchID {
			m = mm
			break
		}
	}
	if m == nil {
		return ErrMatchNotFound
	}
	if m.Completed {
		return ErrMatchAlreadyClosed
	}
	if winner != m.PlayerA && winner != m.PlayerB {
		return ErrInvalidWinner
	}
	m.Winner = winner
	m.Completed = true

	if isComplete(cur) {
		return e.advance(s)
	}
	return nil
}

// startFirstRound builds the initial bracket: shuffle players into a
// power-of-two slot table, then collapse adjacent slots into matches,
// with a random subset of pairs becoming byes.
func (e *Engine) startFirstRound(s *State) error {
	n := len(s.Players)
	bracketSize := nextPowerOf2(n)
	pairs := bracketSize / 2
	byes := bracketSize - n

	shuffled := append([]string(nil), s.Players...)
	rand.Shuffle(len(shuffled), func(i, j int) { shuffled[i], shuffled[j] = shuffled[j], shuffled[i] })

	pairOrder := make([]int, pairs)
	for i := range pairOrder {
		pairOrder[i] = i
	}
	rand.Shuffle(len(pairOrder), func(i, j int) { pairOrder[i], pairOrder[j] = pairOrder[j], pairOrder[i] })
	byePair := make(map[int]bool, byes)
	for i := 0; i < byes; i++ {
		byePair[pairOrder[i]] = true
	}

	round := &Round{Number: 1, Matches: make([]*Match, 0, pairs)}
	cursor := 0
	for p := 0; p < pairs; p++ {
		m := &Match{ID: fmt.Sprintf("r1m%d", p)}
		if byePair[p] {
			m.PlayerA = shuffled[cursor]
			cursor++
			m.IsBye = true
			m.Winner = m.PlayerA
			m.Completed = true
		} else {
			m.PlayerA = shuffled[cursor]
			m.PlayerB = shuffled[cursor+1]
			cursor += 2
		}
		round.Matches = append(round.Matches, m)
	}

	if err := e.draftRound(s, round); err != nil {
		return err
	}
	s.Rounds = append(s.Rounds, round)
	return nil
}

// advance is called once the current round is fully decided. It either
// crowns a champion (if a single winner remains) or creates the next
// round by pairing winners 0&1, 2&3, … and drafting champions for them.
func (e *Engine) advance(s *State) error {
	cur := s.Rounds[len(s.Rounds)-1]
	winners := make([]string, len(cur.Matches))
	for i, m := range cur.Matches {
		winners[i] = m.Winner
	}
	if len(winners) == 1 {
		s.Done = true
		s.Champion = winners[0]
		return nil
	}
	nextNum := cur.Number + 1
	next := &Round{Number: nextNum, Matches: make([]*Match, 0, len(winners)/2)}
	for i := 0; i < len(winners); i += 2 {
		next.Matches = append(next.Matches, &Match{
			ID:      fmt.Sprintf("r%dm%d", nextNum, i/2),
			PlayerA: winners[i],
			PlayerB: winners[i+1],
		})
	}
	if err := e.draftRound(s, next); err != nil {
		return err
	}
	s.Rounds = append(s.Rounds, next)
	return nil
}

// draftRound assigns one champion per player for every non-bye match in
// the round, drawing from the pool of champions not yet used in this
// tournament. Champions never repeat — within the round or across rounds.
func (e *Engine) draftRound(s *State, r *Round) error {
	needed := 0
	for _, m := range r.Matches {
		if !m.IsBye {
			needed += 2
		}
	}
	if needed == 0 {
		return nil
	}

	avail := make([]champions.Champion, 0, len(e.pool.Champions))
	for _, c := range e.pool.Champions {
		if !s.usedChamps[c.ID] {
			avail = append(avail, c)
		}
	}
	if len(avail) < needed {
		return fmt.Errorf("%w: need %d, have %d", ErrChampPoolExhausted, needed, len(avail))
	}

	rand.Shuffle(len(avail), func(i, j int) { avail[i], avail[j] = avail[j], avail[i] })
	picks := avail[:needed]
	for _, c := range picks {
		s.usedChamps[c.ID] = true
	}

	idx := 0
	for _, m := range r.Matches {
		if m.IsBye {
			continue
		}
		a, b := picks[idx], picks[idx+1]
		m.ChampA = &a
		m.ChampB = &b
		idx += 2
	}
	return nil
}

func validatePlayers(players []string) ([]string, error) {
	cleaned := make([]string, 0, len(players))
	seen := make(map[string]bool, len(players))
	for _, p := range players {
		t := strings.TrimSpace(p)
		if t == "" {
			continue
		}
		key := strings.ToLower(t)
		if seen[key] {
			return nil, ErrDuplicateNames
		}
		seen[key] = true
		cleaned = append(cleaned, t)
	}
	if len(cleaned) < MinPlayers {
		return nil, ErrTooFewPlayers
	}
	if len(cleaned) > MaxPlayers {
		return nil, ErrTooManyPlayers
	}
	return cleaned, nil
}

func isComplete(r *Round) bool {
	for _, m := range r.Matches {
		if !m.Completed {
			return false
		}
	}
	return true
}

func nextPowerOf2(n int) int {
	p := 1
	for p < n {
		p <<= 1
	}
	return p
}
