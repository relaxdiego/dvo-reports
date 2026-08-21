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
	mux.HandleFunc("POST /api/reports", func(w http.ResponseWriter, r *http.Request) {
		submit(w, r, cfg)
	})
	return cors(cfg.AllowedOrigins, mux)
}

func submit(w http.ResponseWriter, r *http.Request, cfg Config) {
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

	receipt, err := cfg.Upstream.Submit(r.Context(), rep)
	if err != nil {
		// The upstream error may quote the city site's own HTML. Log it,
		// but tell the citizen something they can act on.
		cfg.Log.Error("upstream submit failed", "category", rep.Category, "photos", len(rep.Photos), "err", err)
		writeError(w, http.StatusBadGateway, "the city's reporting site did not accept the report; please try again later")
		return
	}
	cfg.Log.Info("report submitted", "category", rep.Category, "photos", len(rep.Photos), "reference", receipt.Reference)
	writeJSON(w, http.StatusCreated, receipt)
}

// parseReport reads the form fields. It does not judge them; Validate does.
func parseReport(r *http.Request) (report.Report, error) {
	rep := report.Report{
		Category:    strings.TrimSpace(r.FormValue("category")),
		Description: strings.TrimSpace(r.FormValue("description")),
		Address:     strings.TrimSpace(r.FormValue("address")),
		Contact:     strings.TrimSpace(r.FormValue("contact")),
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
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
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

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
