// Package report holds the shape of a citizen report and the rules for a
// valid one. It has no knowledge of HTTP or of the upstream city site.
package report

import (
	"fmt"
	"strings"
)

// MaxPhotos is the number of images one report may carry.
const MaxPhotos = 5

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
	// Category is the kind of issue, e.g. "pothole". The valid values are
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
// The six are the issues Davao residents raise most that also suit this form,
// which wants a photograph and a pin. That rules out complaints with nothing
// to photograph (noise) and ones the city does not own (water and power cuts,
// which are DCWD's and Davao Light's). They are ordered by how often the
// thing is reported, so the common ones sit in the first row of chips.
//
// A wrong pick costs little, because the description is what carries the
// report. Prefer "other" over a seventh chip.
var Categories = []string{
	"garbage",
	"drainage",
	"pothole",
	"streetlight",
	"obstruction",
	"illegal-parking",
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
	if n := len(strings.TrimSpace(r.Description)); n < 10 {
		return fmt.Errorf("description is %d characters, need at least 10", n)
	} else if n > 2000 {
		return fmt.Errorf("description is %d characters, limit is 2000", n)
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
