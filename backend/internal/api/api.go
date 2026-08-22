// Package api exposes the backend over HTTP.
//
// The handler is a plain http.Handler with no framework and no cloud SDK, so
// the same binary runs locally, in a container, and behind a function
// runtime that speaks HTTP.
package api

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/relaxdiego/dvo-reports/backend/internal/photo"
	"github.com/relaxdiego/dvo-reports/backend/internal/place"
	"github.com/relaxdiego/dvo-reports/backend/internal/report"
	"github.com/relaxdiego/dvo-reports/backend/internal/upstream"
)

// maxRequestBytes caps the whole multipart body: MaxPhotos images at
// MaxPhotoBytes each, plus room for the text fields.
const maxRequestBytes = report.MaxPhotos*report.MaxPhotoBytes + (1 << 20)

// Config is what New needs to build the handler.
type Config struct {
	// Upstream is the city client. Required.
	Upstream upstream.Client
	// AllowedOrigins are the exact Origin values the browser app is served
	// from. Empty means same-origin only.
	AllowedOrigins []string
	// Log receives one line per request outcome. Required.
	Log *slog.Logger
	// Places names the street a pin sits on, the way the city's own form
	// does. Optional: without it a report carries its coordinates alone,
	// which is what happened before there was a geocoder at all.
	Places place.Geocoder
	// AlertURL is posted to when a report is not filed, so a broken submit
	// path reaches somebody. Optional, and set in production only: staging
	// files nothing, so it has nothing to report. See alert.
	AlertURL string
}

// New returns the backend's HTTP routes.
func New(cfg Config) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		io.WriteString(w, "ok\n")
	})
	mux.HandleFunc("GET /api/categories", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"categories": report.Categories})
	})
	mux.HandleFunc("POST /api/auth/otp", func(w http.ResponseWriter, r *http.Request) {
		sendOTP(w, r, cfg)
	})
	mux.HandleFunc("POST /api/auth/session", func(w http.ResponseWriter, r *http.Request) {
		verifyOTP(w, r, cfg)
	})
	mux.HandleFunc("POST /api/reports", func(w http.ResponseWriter, r *http.Request) {
		submit(w, r, cfg)
	})
	mux.HandleFunc("GET /api/reports", func(w http.ResponseWriter, r *http.Request) {
		myReports(w, r, cfg)
	})
	// The street under a pin. Read-only, and about a place rather than a
	// person: it needs no session, and nothing about the answer is kept.
	mux.HandleFunc("GET /api/place", func(w http.ResponseWriter, r *http.Request) {
		namePlace(w, r, cfg)
	})

	mux.HandleFunc("GET /api/reports/{reference}", func(w http.ResponseWriter, r *http.Request) {
		history(w, r, cfg)
	})
	return cors(cfg.AllowedOrigins, mux)
}

// sessionExpiredMessage is what a reporter sees when the city stops accepting
// their token. The frontend asks for a new code and tries again.
const sessionExpiredMessage = "your session with the city's site has expired; ask for a new code and try again"

// sessionHeader carries the city's session token. It is not a bearer token:
// the city wants it as a form field, and this backend puts it there.
const sessionHeader = "X-City-Session"

// sendOTP asks the city to send a one-time code. The e-mail address is
// relayed and not kept, and never reaches the log.
func sendOTP(w http.ResponseWriter, r *http.Request, cfg Config) {
	var in struct {
		Email string `json:"email"`
	}
	if err := readJSON(r, &in); err != nil || strings.TrimSpace(in.Email) == "" {
		writeError(w, http.StatusBadRequest, "an email address is required")
		return
	}
	if err := cfg.Upstream.SendOTP(r.Context(), strings.TrimSpace(in.Email)); err != nil {
		cfg.Log.Error("upstream sendOTP failed", "err", err)
		writeError(w, http.StatusBadGateway, "the city's site could not send a code; please try again later")
		return
	}
	cfg.Log.Info("otp requested")
	w.WriteHeader(http.StatusNoContent)
}

// verifyOTP exchanges the code for a session and hands it back to the
// browser, which is the only place it is kept.
func verifyOTP(w http.ResponseWriter, r *http.Request, cfg Config) {
	var in struct {
		Email string `json:"email"`
		OTP   string `json:"otp"`
	}
	if err := readJSON(r, &in); err != nil || strings.TrimSpace(in.Email) == "" || strings.TrimSpace(in.OTP) == "" {
		writeError(w, http.StatusBadRequest, "an email address and a code are required")
		return
	}
	session, err := cfg.Upstream.VerifyOTP(r.Context(), strings.TrimSpace(in.Email), strings.TrimSpace(in.OTP))
	if err != nil {
		cfg.Log.Error("upstream verifyOTP failed", "err", err)
		writeError(w, http.StatusUnauthorized, "that code was not accepted; check it or ask for a new one")
		return
	}
	cfg.Log.Info("session issued")
	writeJSON(w, http.StatusOK, session)
}

// myReports lists what this reporter has already filed. The list holds their
// own report bodies and locations, so it is relayed to their browser and
// nothing about it is kept or logged beyond how many there were.
func myReports(w http.ResponseWriter, r *http.Request, cfg Config) {
	token := strings.TrimSpace(r.Header.Get(sessionHeader))
	if token == "" {
		writeError(w, http.StatusUnauthorized, "sign in with a code from the city's site to see your reports")
		return
	}
	filed, err := cfg.Upstream.MyReports(r.Context(), token)
	switch {
	case errors.Is(err, upstream.ErrSessionExpired):
		writeError(w, http.StatusUnauthorized, sessionExpiredMessage)
		return
	case err != nil:
		cfg.Log.Error("upstream list failed", "err", err)
		writeError(w, http.StatusBadGateway, "the city's site could not list your reports; please try again later")
		return
	}
	cfg.Log.Info("reports listed", "count", len(filed))
	writeJSON(w, http.StatusOK, map[string]any{"reports": filed})
}

// history says what became of one report. The city decides whose reports a
// token may read, so this passes the reference straight through.
func history(w http.ResponseWriter, r *http.Request, cfg Config) {
	token := strings.TrimSpace(r.Header.Get(sessionHeader))
	if token == "" {
		writeError(w, http.StatusUnauthorized, "sign in with a code from the city's site to see your reports")
		return
	}
	reference := strings.TrimSpace(r.PathValue("reference"))
	if reference == "" {
		writeError(w, http.StatusBadRequest, "a reference is required")
		return
	}
	h, err := cfg.Upstream.History(r.Context(), reference, token)
	switch {
	case errors.Is(err, upstream.ErrSessionExpired):
		writeError(w, http.StatusUnauthorized, sessionExpiredMessage)
		return
	case errors.Is(err, upstream.ErrNoSuchReport):
		writeError(w, http.StatusNotFound, "the city has no report under that reference")
		return
	case err != nil:
		cfg.Log.Error("upstream history failed", "err", err)
		writeError(w, http.StatusBadGateway, "the city's site could not tell what happened to that report; please try again later")
		return
	}
	cfg.Log.Info("report history read", "steps", len(h.Steps))
	writeJSON(w, http.StatusOK, h)
}

func submit(w http.ResponseWriter, r *http.Request, cfg Config) {
	token := strings.TrimSpace(r.Header.Get(sessionHeader))
	if token == "" {
		writeError(w, http.StatusUnauthorized, "sign in with a code from the city's site before reporting")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBytes)
	if err := r.ParseMultipartForm(4 << 20); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, http.StatusRequestEntityTooLarge, "the report is larger than the limit; try fewer or smaller photos")
			return
		}
		writeError(w, http.StatusBadRequest, "the request is not a valid multipart form")
		return
	}
	defer r.MultipartForm.RemoveAll()

	rep, err := parseReport(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := rep.Validate(); err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	// A submission that fails is debugged from this log line and nothing
	// else, because nothing is stored: the report is gone the moment this
	// handler returns. So the line carries everything about the attempt that
	// is not the citizen's own — never the description, the address, the
	// coordinates, or the photographs.
	started := time.Now()
	receipt, err := cfg.Upstream.Submit(r.Context(), rep, token)
	attempt := []any{
		"category", rep.Category,
		"photos", len(rep.Photos),
		"photo_bytes", photoBytes(rep.Photos),
		"took_ms", time.Since(started).Milliseconds(),
	}
	switch {
	case errors.Is(err, upstream.ErrSessionExpired):
		cfg.Log.Info("upstream session expired", "category", rep.Category)
		writeError(w, http.StatusUnauthorized, sessionExpiredMessage)
		return
	case errors.Is(err, upstream.ErrPhotosNotAttached):
		// The report is filed and has a real reference. Saying it failed
		// would be worse than saying the photos did not make it.
		cfg.Log.Error("upstream photos not attached", append(attempt, "reference", receipt.Reference, "err", err)...)
		alert(cfg, "a report was filed but its photos were not attached to it. Read the reason with: fly logs -a dvo-reports-api | grep 'upstream photos not attached'")
		writeJSON(w, http.StatusCreated, photosMissing{Receipt: receipt, Warning: "the report was filed, but the photos did not upload; you can add them on the city's own site using the reference"})
		return
	case err != nil:
		// The upstream error may quote the city site's own HTML. Log it,
		// but tell the citizen something they can act on.
		cfg.Log.Error("upstream submit failed", append(attempt, "err", err)...)
		alert(cfg, "a report was not filed: the city's site did not accept it. Read the reason with: fly logs -a dvo-reports-api | grep 'upstream submit failed'")
		writeError(w, http.StatusBadGateway, "the city's reporting site did not accept the report; please try again later")
		return
	}
	cfg.Log.Info("report submitted", append(attempt, "reference", receipt.Reference)...)
	writeJSON(w, http.StatusCreated, receipt)
}

// photoBytes totals the photo sizes for the log. The count alone hides a
// failure that depends on size, and the city has a limit this project does
// not know.
func photoBytes(photos []report.Photo) int {
	n := 0
	for _, p := range photos {
		n += len(p.Data)
	}
	return n
}

// parseReport reads the form fields. It does not judge them; Validate does.
func parseReport(r *http.Request) (report.Report, error) {
	rep := report.Report{
		Category:    strings.TrimSpace(r.FormValue("category")),
		Description: strings.TrimSpace(r.FormValue("description")),
		Address:     strings.TrimSpace(r.FormValue("address")),
	}
	var err error
	if rep.Lat, err = parseCoord(r.FormValue("lat")); err != nil {
		return rep, errors.New("lat is not a number")
	}
	if rep.Lon, err = parseCoord(r.FormValue("lon")); err != nil {
		return rep, errors.New("lon is not a number")
	}

	files := r.MultipartForm.File["photos"]
	if len(files) > report.MaxPhotos {
		// Stop before reading them all into memory.
		return rep, errors.New("too many photos")
	}
	for _, fh := range files {
		p, err := readPhoto(fh)
		if err != nil {
			return rep, err
		}
		rep.Photos = append(rep.Photos, p)
	}
	return rep, nil
}

func parseCoord(s string) (float64, error) {
	if strings.TrimSpace(s) == "" {
		return 0, nil
	}
	return strconv.ParseFloat(s, 64)
}

func readPhoto(fh *multipart.FileHeader) (report.Photo, error) {
	f, err := fh.Open()
	if err != nil {
		return report.Photo{}, errors.New("could not read photo " + fh.Filename)
	}
	defer f.Close()
	// One byte past the limit, so an oversized photo is detected here rather
	// than silently truncated.
	data, err := io.ReadAll(io.LimitReader(f, report.MaxPhotoBytes+1))
	if err != nil {
		return report.Photo{}, errors.New("could not read photo " + fh.Filename)
	}
	// The one place metadata is decided. A phone writes its model, its
	// software, and where the picture was taken into the file; photo.Clean
	// keeps the few fields this project sends on and drops the rest. It runs
	// here, on the way in, so nothing downstream ever holds the original.
	data = photo.Clean(data)
	return report.Photo{
		Filename: fh.Filename,
		// Sniffed from the bytes, not read from the part's Content-Type
		// header. The header is whatever the client chose to write, and this
		// backend hands the file on to a government site.
		MediaType: http.DetectContentType(data),
		Data:      data,
	}, nil
}

// cors answers preflight requests and marks responses for the browser app,
// which is served from a different origin than this backend.
func cors(allowed []string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && slicesContains(allowed, origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Add("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, "+sessionHeader)
			w.Header().Set("Access-Control-Max-Age", "86400")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func slicesContains(list []string, want string) bool {
	for _, s := range list {
		if s == want {
			return true
		}
	}
	return false
}

// photosMissing is a receipt for a report the city filed without its photos.
type photosMissing struct {
	upstream.Receipt
	Warning string `json:"warning"`
}

// readJSON decodes a small JSON request body.
func readJSON(r *http.Request, out any) error {
	return json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(out)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// namePlace answers with the street a pin sits on. A failure here is not the
// citizen's problem: the form falls back to the coordinates, which the city
// accepts, so this answers 200 with an empty address rather than an error
// the reporter would have to do something about.
//
// The coordinates are never logged. They are a citizen's location.
func namePlace(w http.ResponseWriter, r *http.Request, cfg Config) {
	lat, errLat := strconv.ParseFloat(r.URL.Query().Get("lat"), 64)
	lon, errLon := strconv.ParseFloat(r.URL.Query().Get("lon"), 64)
	if errLat != nil || errLon != nil || lat < -90 || lat > 90 || lon < -180 || lon > 180 {
		writeError(w, http.StatusBadRequest, "lat and lon must be coordinates")
		return
	}
	if cfg.Places == nil {
		writeJSON(w, http.StatusOK, place.Place{})
		return
	}
	found, err := cfg.Places.Reverse(r.Context(), lat, lon)
	if err != nil {
		cfg.Log.Warn("reverse geocode failed", "err", err)
		writeJSON(w, http.StatusOK, place.Place{})
		return
	}
	writeJSON(w, http.StatusOK, found)
}
