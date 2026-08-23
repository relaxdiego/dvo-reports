// Package report holds the shape of a citizen report and the rules for a
// valid one. It has no knowledge of HTTP or of the upstream city site.
package report

import (
	"fmt"
	"strings"
	"unicode/utf16"

	"github.com/relaxdiego/dvo-reports/backend/internal/photo"
)

// MaxPhotos is the number of images one report may carry.
const MaxPhotos = 5

// MinDescription and MaxDescription bound the free-text account of the
// issue, counted as DescriptionLength counts.
//
// The maximum is the city's own. Their form declares maxlength="1000" on the
// description box and counts up to the same number beneath it. What the API
// behind that form does with a longer one is untested, and a real citizen's
// report is not the way to find out: it may be cut, or refused. So a report
// this client accepts is one the city's form would have accepted.
const (
	MinDescription = 10
	MaxDescription = 1000
)

// DescriptionLength counts a description the way the city's form counts one:
// in UTF-16 code units, which is what JavaScript's String.length gives their
// counter. It is not the count a person would make. An emoji, and anything
// else outside the Basic Multilingual Plane, counts as two.
//
// Go's own len() would count bytes, which is a stricter limit than the city
// applies — an accented character is two bytes and one unit — and would turn
// away reports their form would have taken. The browser copy of this rule
// counts with String.length, so the two agree.
func DescriptionLength(s string) int {
	return len(utf16.Encode([]rune(s)))
}

// MaxPhotoBytes is the size limit for a single image, after the browser has
// already downscaled it. Anything larger is a sign the client skipped that
// step.
const MaxPhotoBytes = 5 << 20 // 5 MiB

// Photo is one uploaded image, held in memory. Reports are relayed straight
// to the upstream site, so nothing here is ever written to disk.
type Photo struct {
	Filename  string
	MediaType string
	Data      []byte
}

// Report is one issue a citizen wants to raise with the city.
type Report struct {
	// Category is the kind of issue, e.g. "garbage". The valid values are
	// this project's own; see Categories.
	Category string
	// Description is the free-text account of the issue.
	Description string
	// Address is a human-readable location, and is optional. This project's
	// own front end stopped collecting one when the map became the way a
	// place is set; the city's form still prefers it when it is there.
	Address string
	// Lat and Lon are where the problem is. Both zero means no place was
	// given, which a report cannot be filed without.
	Lat, Lon float64
	// Photos is what the citizen saw. A report needs at least one: it is
	// what the city acts on, and what the place is usually read from.
	Photos []Photo
}

// Categories are the issue types this client offers. The city's form has no
// category field, so this list answers to nobody upstream: it exists to save
// the reporter typing and to put a word the clerk knows at the front of the
// title. See upstream.titleFor.
//
// The five are the issues Davao residents raise most that also suit this
// form, which wants a photograph and a pin. That rules out complaints with
// nothing to photograph (noise) and ones the city does not own (water and
// power cuts, which are DCWD's and Davao Light's). The order is the chip
// order and is set in CATEGORIES in frontend/src/types.ts, which says why;
// keep this list in step with it.
//
// "obstruction" is the whole of what makes a road unsafe — a pothole, debris,
// an open manhole, a fallen tree — and had a "pothole" chip beside it until
// the two were merged. One chip covering both beats asking a reporter to
// choose between two that fit.
//
// A wrong pick costs little, because the description is what carries the
// report. Prefer "other" over a sixth chip.
var Categories = []string{
	"garbage",
	"obstruction",
	"streetlight",
	"illegal-parking",
	"drainage",
	"other",
}

// HasLocation reports whether the browser supplied coordinates.
func (r Report) HasLocation() bool { return r.Lat != 0 || r.Lon != 0 }

// Validate returns the first reason the report cannot be submitted, or nil.
// The same rules run in the browser; this copy is the one that is trusted.
func (r Report) Validate() error {
	if !validCategory(r.Category) {
		return fmt.Errorf("category %q is not one of %s", r.Category, strings.Join(Categories, ", "))
	}
	if n := DescriptionLength(strings.TrimSpace(r.Description)); n < MinDescription {
		return fmt.Errorf("description is %d characters, need at least %d", n, MinDescription)
	} else if n > MaxDescription {
		return fmt.Errorf("description is %d characters, limit is %d", n, MaxDescription)
	}
	if len(r.Photos) == 0 {
		return fmt.Errorf("a report needs at least one photo")
	}
	if !r.HasLocation() {
		return fmt.Errorf("need coordinates")
	}
	if r.Lat < -90 || r.Lat > 90 || r.Lon < -180 || r.Lon > 180 {
		return fmt.Errorf("coordinates %g,%g are out of range", r.Lat, r.Lon)
	}
	if len(r.Photos) > MaxPhotos {
		return fmt.Errorf("%d photos, limit is %d", len(r.Photos), MaxPhotos)
	}
	for _, p := range r.Photos {
		if !strings.HasPrefix(p.MediaType, "image/") {
			return fmt.Errorf("photo %q has type %q, which is not an image", p.Filename, p.MediaType)
		}
		if len(p.Data) > MaxPhotoBytes {
			return fmt.Errorf("photo %q is %d bytes, limit is %d", p.Filename, len(p.Data), MaxPhotoBytes)
		}
		// The place on a report is the one its photographs recorded. Nobody
		// types it and nobody drags a pin, so a photograph that does not
		// carry one leaves the report saying nothing about where the problem
		// is. The browser turns such a photo away before it is uploaded;
		// this is the copy of that rule that is trusted.
		if !photo.HasLocation(p.Data) {
			return fmt.Errorf("photo %q does not record where it was taken", p.Filename)
		}
	}
	return nil
}

func validCategory(c string) bool {
	for _, known := range Categories {
		if c == known {
			return true
		}
	}
	return false
}
