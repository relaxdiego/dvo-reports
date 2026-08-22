package api

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// alert posts one line to Config.AlertURL, so that a broken submit path is
// noticed by somebody rather than sitting in a log nobody is reading. Filing
// is exercised in production only, so this is how it is found.
//
// It carries no part of the report: not the description, the address, the
// coordinates, a photograph, nor the city's own reply, which can quote the
// title — and so a summary of the description — back. The alert says what
// broke and where the rest is; the rest stays in the log. A report is a real
// person's location and photographs, and none of it goes to a third party.
//
// It is sent on its own timer rather than the request's. The reporter's
// browser has its answer already and must not wait for a webhook, and
// r.Context() is cancelled the moment the handler returns.
func alert(cfg Config, text string) {
	if cfg.AlertURL == "" {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.AlertURL, strings.NewReader(text))
		if err != nil {
			cfg.Log.Error("alert not sent", "err", scrub(err))
			return
		}
		req.Header.Set("Content-Type", "text/plain; charset=utf-8")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			cfg.Log.Error("alert not sent", "err", scrub(err))
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode > 299 {
			cfg.Log.Error("alert refused", "status", resp.Status)
		}
	}()
}

// scrub drops the URL from an HTTP error. AlertURL is a secret — with
// healthchecks.io the whole address is the credential — and an error from
// net/http quotes the address it called.
func scrub(err error) error {
	var uerr *url.Error
	if errors.As(err, &uerr) {
		return uerr.Err
	}
	return err
}
