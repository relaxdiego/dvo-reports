package upstream

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/relaxdiego/dvo-reports/backend/internal/report"
)

// DefaultBaseURL is the city site's API, read from its own front end
// (js/main2.js). It is not documented and can change without warning.
const DefaultBaseURL = "https://dcrfunctions2.azurewebsites.net/api/"

// maxTitleRunes caps the title built from the description. The city's form
// has a maxlength on the field, but the number is not readable from the
// scripts, so this is a guess on the safe side.
const maxTitleRunes = 100

// ErrSessionExpired means the city rejected the token. The reporter has to
// ask for a new OTP.
var ErrSessionExpired = errors.New("the city session has expired")

// ErrNoSuchReport means the city has no report under that control number for
// this reporter. A control number belonging to somebody else looks the same.
var ErrNoSuchReport = errors.New("no report with that reference")

// ErrPhotosNotAttached means the report reached the city and has a reference,
// but the photos did not. The report exists; do not tell the reporter it
// failed.
var ErrPhotosNotAttached = errors.New("the report was filed without its photos")

// Session is what the city gives back after a verified OTP.
type Session struct {
	// Token goes on every later call as xtk. It is not a bearer token.
	Token string `json:"token"`
	// Expires is when the city stops accepting Token. Zero if the city did
	// not say.
	Expires time.Time `json:"expires,omitempty"`
}

// City talks to reports.davaocity.gov.ph.
//
// The city has no API. Everything here imitates what its own web form does,
// so every field name and response shape is a guess that its front end
// currently agrees with.
type City struct {
	// BaseURL is the API root. Empty means DefaultBaseURL.
	BaseURL string
	// HTTP is the client used for every call. Empty means a client with a
	// 30 second timeout.
	HTTP *http.Client
}

// SendOTP asks the city to send a one-time code to the account registered
// under email. The account must exist and have a verified e-mail address;
// registering is done on the city's own site.
func (c *City) SendOTP(ctx context.Context, email string) error {
	var out struct {
		Request string `json:"request"`
		Details string `json:"details"`
	}
	q := url.Values{"email": {email}, "trans": {"sendOTP"}}
	if err := c.get(ctx, "verify/", q, &out); err != nil {
		return err
	}
	if out.Request != "success" {
		return fmt.Errorf("city refused to send an OTP: %s", fallback(out.Details, "no reason given"))
	}
	return nil
}

// VerifyOTP exchanges the code for a session. Nothing about the session is
// kept here; the caller hands it straight back to the reporter's browser.
func (c *City) VerifyOTP(ctx context.Context, email, otp string) (Session, error) {
	var out struct {
		Request string `json:"request"`
		Details string `json:"details"`
		Data    struct {
			Token     string `json:"token"`
			TkDetails struct {
				TkExp string `json:"tkexp"`
			} `json:"tkdetails"`
		} `json:"data"`
	}
	q := url.Values{"email": {email}, "otp": {otp}, "trans": {"verifyotp"}}
	if err := c.get(ctx, "verify", q, &out); err != nil {
		return Session{}, err
	}
	if out.Request == "error" || out.Data.Token == "" {
		return Session{}, fmt.Errorf("city refused the OTP: %s", fallback(out.Details, "no reason given"))
	}
	s := Session{Token: out.Data.Token}
	// The city has used more than one layout for this timestamp. A session
	// with no expiry still works; the reporter just finds out late.
	if t, err := time.Parse(time.RFC3339, out.Data.TkDetails.TkExp); err == nil {
		s.Expires = t
	}
	return s, nil
}

// Submit files one report and returns the city's control number.
//
// The city needs two requests: ADD creates the report, ATTACH adds the
// photos to it. That is hidden here, so a caller sees one submission. If
// ADD succeeds and ATTACH does not, the returned Receipt still holds the
// real reference and the error wraps ErrPhotosNotAttached — the report was
// filed, and saying otherwise would be a lie.
func (c *City) Submit(ctx context.Context, r report.Report, token string) (Receipt, error) {
	ref, err := c.post(ctx, r, token, "ADD", "", nil)
	if err != nil {
		return Receipt{}, err
	}
	if ref == "" {
		return Receipt{}, errors.New("the city accepted the report but returned no control number")
	}
	if len(r.Photos) > 0 {
		if _, err := c.post(ctx, r, token, "ATTACH", ref, r.Photos); err != nil {
			return Receipt{Reference: ref}, fmt.Errorf("%w: %v", ErrPhotosNotAttached, err)
		}
	}
	// The city has no shareable tracking page: following a report is another
	// call that needs the reporter's own session. Receipt.TrackURL stays
	// empty on purpose.
	return Receipt{Reference: ref}, nil
}

// MyReports lists the reports filed by the session's owner.
//
// The city's own tracking page reads the same call (js/trackingView.js:380).
// It returns every report the account has filed, in no particular order.
func (c *City) MyReports(ctx context.Context, token string) ([]Filed, error) {
	var out struct {
		IsValid *bool `json:"isValid"`
		Data    []struct {
			ControlNo    flexString `json:"controlno"`
			Title        string     `json:"title"`
			Complain     string     `json:"complain"`
			Location     string     `json:"location"`
			Status       string     `json:"current_status"`
			DateReported string     `json:"date_reported"`
			Attachments  []struct {
				Link string `json:"link"`
			} `json:"attachments"`
		} `json:"data"`
	}
	q := url.Values{"trans": {"getuserdetails"}, "xtk": {token}}
	if err := c.get(ctx, "reportController", q, &out); err != nil {
		return nil, err
	}
	if out.IsValid != nil && !*out.IsValid {
		return nil, ErrSessionExpired
	}
	filed := make([]Filed, 0, len(out.Data))
	for _, d := range out.Data {
		f := Filed{
			Reference:   string(d.ControlNo),
			Title:       text(d.Title),
			Description: text(d.Complain),
			Location:    text(d.Location),
			Status:      strings.ToUpper(strings.TrimSpace(d.Status)),
			Filed:       d.DateReported,
		}
		for _, a := range d.Attachments {
			if a.Link != "" {
				f.Photos = append(f.Photos, a.Link)
			}
		}
		filed = append(filed, f)
	}
	return filed, nil
}

// History tells what became of one filed report.
//
// The city answers with the report's status changes, the offices that were
// sent it, and the reason behind a status that needs one. A reporter can only
// read their own reports: the token decides whose they are, and a control
// number belonging to somebody else comes back empty.
func (c *City) History(ctx context.Context, reference, token string) (History, error) {
	var out struct {
		IsValid *bool `json:"isValid"`
		Data    []struct {
			Status    string `json:"status"`
			Office    string `json:"officename"`
			StartDate string `json:"startdate"`
		} `json:"data"`
		Result []struct {
			Office      string `json:"office"`
			Attachments []struct {
				URL string `json:"url"`
			} `json:"attachments"`
		} `json:"result"`
		Invalid     reason     `json:"invalid"`
		Resubmit    reason     `json:"resubmit"`
		ReferenceNo flexString `json:"referenceno"`
	}
	q := url.Values{"trans": {"getdetails"}, "controlno": {reference}, "xtk": {token}}
	if err := c.get(ctx, "complainController", q, &out); err != nil {
		return History{}, err
	}
	if out.IsValid != nil && !*out.IsValid {
		return History{}, ErrSessionExpired
	}
	if len(out.Data) == 0 {
		return History{}, ErrNoSuchReport
	}
	h := History{Reference: reference, CityReference: string(out.ReferenceNo)}
	for _, d := range out.Data {
		h.Steps = append(h.Steps, Step{
			Status: strings.ToUpper(strings.TrimSpace(d.Status)),
			Office: text(d.Office),
			At:     d.StartDate,
		})
	}
	// The city sends the reason for a rejected report and for one it wants
	// filed again in two separate places, and only one of them can apply.
	for _, step := range h.Steps {
		switch step.Status {
		case "INVALID":
			h.Note = out.Invalid.Reason
		case "FORRESUBMISSION":
			h.Note = out.Resubmit.Reason
		}
	}
	for _, r := range out.Result {
		if r.Office == "" {
			continue
		}
		res := Resolution{Office: text(r.Office)}
		for _, a := range r.Attachments {
			if a.URL != "" {
				res.Files = append(res.Files, a.URL)
			}
		}
		h.Resolutions = append(h.Resolutions, res)
	}
	return h, nil
}

// post sends one complainController request and returns the control number.
func (c *City) post(ctx context.Context, r report.Report, token, trans, contno string, photos []report.Photo) (string, error) {
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	fields := [][2]string{
		{"trans", trans},
		{"xtk", token},
		{"contno", contno},
		{"title", titleFor(r)},
		{"complain", r.Description},
		{"location", locationFor(r)},
		{"coordinates", coordinatesFor(r)},
	}
	for _, f := range fields {
		if err := w.WriteField(f[0], f[1]); err != nil {
			return "", err
		}
	}
	for _, p := range photos {
		part, err := w.CreateFormFile("imagefile", p.Filename)
		if err != nil {
			return "", err
		}
		if _, err := part.Write(p.Data); err != nil {
			return "", err
		}
	}
	if err := w.Close(); err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url("complainController", nil), &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())

	var out struct {
		ControlNo flexString `json:"controlno"`
		Message   string     `json:"message"`
		IsValid   *bool      `json:"isValid"`
	}
	if err := c.do(req, &out); err != nil {
		// Which of the two calls failed is not in the URL — both are
		// complainController, and the step is a field in the body. Say it,
		// or the log cannot tell filing the report from attaching a photo.
		return "", fmt.Errorf("%s: %w", trans, err)
	}
	if out.IsValid != nil && !*out.IsValid {
		return "", ErrSessionExpired
	}
	if out.Message != "" {
		return "", fmt.Errorf("city rejected the report: %s", out.Message)
	}
	return string(out.ControlNo), nil
}

func (c *City) get(ctx context.Context, path string, q url.Values, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.url(path, q), nil)
	if err != nil {
		return err
	}
	return c.do(req, out)
}

// do sends the request and decodes the JSON body. The city answers with HTML
// when it is unhappy, so the body is quoted in the error for the log.
func (c *City) do(req *http.Request, out any) error {
	client := c.HTTP
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		// Path only. The query carries the session token on every read.
		return fmt.Errorf("calling the city site at %s: %w", req.URL.Path, err)
	}
	defer resp.Body.Close()

	// Enough to diagnose a failure, and a bound on what a misbehaving
	// upstream can make this process hold.
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("reading the city's reply: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("city returned %s from %s: %s", resp.Status, req.URL.Path, strings.TrimSpace(string(body)))
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("city returned %q, which is not the JSON expected: %w", strings.TrimSpace(string(body)), err)
	}
	return nil
}

func (c *City) url(path string, q url.Values) string {
	base := c.BaseURL
	if base == "" {
		base = DefaultBaseURL
	}
	u := strings.TrimSuffix(base, "/") + "/" + path
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	return u
}

// titleFor builds the title the city's form asks for. This project collects
// a category and the city does not have one, so the category becomes a
// prefix on a short version of the description. "other" has no useful label,
// so it gets no prefix.
func titleFor(r report.Report) string {
	summary := summarize(r.Description)
	if label, ok := categoryLabels[r.Category]; ok {
		return label + ": " + summary
	}
	return summary
}

// categoryLabels are the report.Categories in words. They are the same words
// the reporter picked, so the title the clerk reads names the thing the chip
// named: keep this list in step with CATEGORY_LABELS in frontend/src/types.ts.
// Where a chip adds something only the reporter needs — a Bisaya name, a
// second example — this keeps the base word alone. "other" is absent on
// purpose; see titleFor.
var categoryLabels = map[string]string{
	"garbage":         "Garbage",
	"drainage":        "Drainage",
	"pothole":         "Pothole",
	"streetlight":     "Street light",
	"obstruction":     "Blocked road",
	"illegal-parking": "Illegal parking",
}

// summarize collapses the description onto one line and cuts it to a title's
// length, on a word boundary where there is one.
func summarize(s string) string {
	one := strings.Join(strings.Fields(s), " ")
	if len([]rune(one)) <= maxTitleRunes {
		return one
	}
	cut := string([]rune(one)[:maxTitleRunes])
	if i := strings.LastIndex(cut, " "); i > maxTitleRunes/2 {
		cut = cut[:i]
	}
	return strings.TrimRight(cut, " ,.;:") + "…"
}

// locationFor is the human-readable place. The city's form refuses an empty
// one, so a report that carries only coordinates sends those instead.
func locationFor(r report.Report) string {
	if a := strings.TrimSpace(r.Address); a != "" {
		return a
	}
	return coordinatesFor(r)
}

// coordinatesFor formats the pair the way the city's map control reads it
// back: latitude, then longitude, comma separated (js/map.js).
func coordinatesFor(r report.Report) string {
	if !r.HasLocation() {
		return ""
	}
	return strconv.FormatFloat(r.Lat, 'f', -1, 64) + "," + strconv.FormatFloat(r.Lon, 'f', -1, 64)
}

func fallback(s, or string) string {
	if strings.TrimSpace(s) == "" {
		return or
	}
	return s
}

// text is what the city stored, ready to be read by a person. The city keeps
// the form's input HTML-escaped, so an office called "CITY MAYOR'S OFFICE"
// comes back with the apostrophe written as an entity.
func text(s string) string { return html.UnescapeString(s) }

// reason is the city's explanation for a status that needs one. It arrives as
// an object with a reason when there is one, and as an empty JSON array when
// there is not, so a plain struct cannot read both.
type reason struct {
	Reason string `json:"reason"`
}

func (r *reason) UnmarshalJSON(b []byte) error {
	trimmed := strings.TrimSpace(string(b))
	if !strings.HasPrefix(trimmed, "{") {
		*r = reason{}
		return nil
	}
	// A named type, so decoding does not call this method again.
	type plain reason
	var p plain
	if err := json.Unmarshal(b, &p); err != nil {
		return err
	}
	*r = reason(p)
	return nil
}

// flexString is a JSON string that the city sometimes sends as a number.
type flexString string

func (f *flexString) UnmarshalJSON(b []byte) error {
	s := strings.TrimSpace(string(b))
	if s == "null" || s == "" {
		*f = ""
		return nil
	}
	if strings.HasPrefix(s, `"`) {
		var str string
		if err := json.Unmarshal(b, &str); err != nil {
			return err
		}
		*f = flexString(str)
		return nil
	}
	*f = flexString(s)
	return nil
}
