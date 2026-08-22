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
	// Category is the kind of issue, e.g. "pothole". The set of valid values
	// comes from the upstream site; see Categories.
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

// Categories are the issue types this client offers. They are a placeholder
// until the real list is read from reports.davaocity.gov.ph.
var Categories = []string{
	"pothole",
	"streetlight",
	"garbage",
	"drainage",
	"traffic-signal",
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
