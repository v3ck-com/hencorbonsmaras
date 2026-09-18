package server

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed lots.json
var catalogue []byte

type Lot struct {
	Number    int    `json:"number"`
	Image     string `json:"image"`
	Photo     string `json:"photo"`
	Notes     string `json:"notes"`
	YouTubeID string `json:"youtubeId"`
}

type State struct {
	Revision  int64     `json:"revision"`
	LotNumber int       `json:"lotNumber"`
	Mode      string    `json:"mode"`
	UpdatedAt time.Time `json:"updatedAt"`
	Lots      []Lot     `json:"lots"`
	Rehearsal bool      `json:"rehearsal"`
}

type Store struct {
	DB   *pgxpool.Pool
	lots []Lot
}

var ErrConflict = errors.New("state changed; refresh and retry")
var ErrInvalid = errors.New("invalid lot or media mode")

func NewStore(ctx context.Context, db *pgxpool.Pool) (*Store, error) {
	s := &Store{DB: db}
	if err := json.Unmarshal(catalogue, &s.lots); err != nil {
		return nil, err
	}
	// Add versioned migrations before extending the schema for bidder accounts.
	_, err := db.Exec(ctx, `
 CREATE TABLE IF NOT EXISTS media_state (
 id integer PRIMARY KEY CHECK (id=1), revision bigint NOT NULL DEFAULT 1,
 lot_number integer NOT NULL DEFAULT 1,
 mode text NOT NULL DEFAULT 'recorded' CHECK (mode IN ('live','audio','recorded','image')),
 updated_at timestamptz NOT NULL DEFAULT now());
 INSERT INTO media_state(id) VALUES(1) ON CONFLICT DO NOTHING;
 CREATE TABLE IF NOT EXISTS role_sessions (
 token_hash text PRIMARY KEY, role text NOT NULL CHECK (role IN ('operator','broadcaster')),
 expires_at timestamptz NOT NULL);
 CREATE TABLE IF NOT EXISTS media_audit (
 id bigserial PRIMARY KEY, actor text NOT NULL, action text NOT NULL,
 revision bigint NOT NULL, lot_number integer NOT NULL, mode text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now());`)
	return s, err
}

func (s *Store) State(ctx context.Context) (State, error) {
	st := State{Lots: s.lots, Rehearsal: true}
	err := s.DB.QueryRow(ctx, `SELECT revision,lot_number,mode,updated_at FROM media_state WHERE id=1`).Scan(&st.Revision, &st.LotNumber, &st.Mode, &st.UpdatedAt)
	return st, err
}

func validMode(mode string) bool {
	return mode == "live" || mode == "audio" || mode == "recorded" || mode == "image"
}

func (s *Store) Change(ctx context.Context, revision int64, lot int, mode, actor, action string) (State, error) {
	if lot < 1 || lot > len(s.lots) || !validMode(mode) {
		return State{}, ErrInvalid
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return State{}, err
	}
	defer tx.Rollback(ctx)
	result, err := tx.Exec(ctx, `UPDATE media_state SET revision=revision+1,lot_number=$1,mode=$2,updated_at=now() WHERE id=1 AND revision=$3`, lot, mode, revision)
	if err != nil {
		return State{}, err
	}
	if result.RowsAffected() != 1 {
		return State{}, ErrConflict
	}
	_, err = tx.Exec(ctx, `INSERT INTO media_audit(actor,action,revision,lot_number,mode) VALUES($1,$2,$3,$4,$5)`, actor, action, revision+1, lot, mode)
	if err != nil {
		return State{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return State{}, err
	}
	return s.State(ctx)
}

// Degrade is conditional on the current mode. A stale phone cannot restore
// camera or overwrite a newer operator choice/lot change.
func (s *Store) Degrade(ctx context.Context, actor string) (State, error) {
	st, err := s.State(ctx)
	if err != nil {
		return st, err
	}
	if st.Mode != "live" {
		return st, nil
	}
	return s.Change(ctx, st.Revision, st.LotNumber, "audio", actor, "degrade")
}
