package report

import (
	"bytes"
	"encoding/binary"
	"strings"
	"testing"
)

// geoJPEG is the smallest JPEG that says where it was taken: an Exif segment
// carrying a GPS directory with a latitude and a longitude, and no picture at
// all. It is written big-endian by hand, so what is tested is reading a file
// this project did not produce.
func geoJPEG() []byte {
	entry := func(tag, typ uint16, count, value uint32) []byte {
		b := make([]byte, 12)
		binary.BigEndian.PutUint16(b, tag)
		binary.BigEndian.PutUint16(b[2:], typ)
		binary.BigEndian.PutUint32(b[4:], count)
		binary.BigEndian.PutUint32(b[8:], value)
		return b
	}
	// Degrees, minutes, seconds, each a numerator over a denominator.
	dms := func(d, m, s uint32) []byte {
		var b []byte
		for _, pair := range [][2]uint32{{d, 1}, {m, 1}, {s, 1}} {
			n := make([]byte, 8)
			binary.BigEndian.PutUint32(n, pair[0])
			binary.BigEndian.PutUint32(n[4:], pair[1])
			b = append(b, n...)
		}
		return b
	}

	var tiff bytes.Buffer
	tiff.WriteString("MM")              // big-endian
	tiff.Write([]byte{0, 42})           // the TIFF marker
	tiff.Write([]byte{0, 0, 0, 8})      // IFD0 starts here
	tiff.Write([]byte{0, 1})            // one record in it
	tiff.Write(entry(0x8825, 4, 1, 26)) // the GPS directory
	tiff.Write([]byte{0, 0, 0, 0})      // no second image
	tiff.Write([]byte{0, 2})            // two GPS records
	tiff.Write(entry(0x0002, 5, 3, 56)) // latitude
	tiff.Write(entry(0x0004, 5, 3, 80)) // longitude
	tiff.Write([]byte{0, 0, 0, 0})      // end of the GPS directory
	tiff.Write(dms(7, 5, 51))           // 7°5'51" north
	tiff.Write(dms(125, 37, 20))        // 125°37'20" east

	body := append([]byte("Exif\x00\x00"), tiff.Bytes()...)
	out := []byte{0xFF, 0xD8, 0xFF, 0xE1}
	var n [2]byte
	binary.BigEndian.PutUint16(n[:], uint16(len(body)+2))
	out = append(out, n[:]...)
	out = append(out, body...)
	return append(out, 0xFF, 0xD9)
}

func valid() Report {
	return Report{
		Category:    "pothole",
		Description: "Deep pothole in the outer lane near the corner.",
		Address:     "Quimpo Blvd, Davao City",
		Lat:         7.0731,
		Lon:         125.6128,
		Photos:      []Photo{{Filename: "a.jpg", MediaType: "image/jpeg", Data: geoJPEG()}},
	}
}

func TestValidateAcceptsAGoodReport(t *testing.T) {
	if err := valid().Validate(); err != nil {
		t.Fatalf("want nil, got %v", err)
	}
}

func TestValidateRejects(t *testing.T) {
	cases := map[string]func(*Report){
		"unknown category":   func(r *Report) { r.Category = "aliens" },
		"short description":  func(r *Report) { r.Description = "hole" },
		"long description":   func(r *Report) { r.Description = strings.Repeat("x", MaxDescription+1) },
		"no coordinates":     func(r *Report) { r.Lat, r.Lon = 0, 0 },
		"latitude off earth": func(r *Report) { r.Lat, r.Lon = 91, 125 },
		"no photos at all":   func(r *Report) { r.Photos = nil },
		"too many photos":    func(r *Report) { r.Photos = make([]Photo, MaxPhotos+1) },
		"photo not an image": func(r *Report) { r.Photos = []Photo{{Filename: "a.pdf", MediaType: "application/pdf"}} },
		"photo over the size": func(r *Report) {
			r.Photos = []Photo{{Filename: "a.jpg", MediaType: "image/jpeg", Data: make([]byte, MaxPhotoBytes+1)}}
		},
		// The rule this project is opinionated about: the place comes from
		// the photograph, so a photograph without one is not a report.
		"photo with no place": func(r *Report) {
			r.Photos = []Photo{{Filename: "a.jpg", MediaType: "image/jpeg", Data: []byte{0xFF, 0xD8, 0xFF, 0xD9}}}
		},
		"one photo of several with no place": func(r *Report) {
			r.Photos = append(r.Photos, Photo{Filename: "b.jpg", MediaType: "image/jpeg", Data: []byte{0xFF, 0xD8, 0xFF, 0xD9}})
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			r := valid()
			mutate(&r)
			if err := r.Validate(); err == nil {
				t.Fatal("want an error, got nil")
			}
		})
	}
}

// Coordinates alone are enough. A citizen in the field may not know the
// street name, and this project's own front end no longer asks for one: the
// place is set by moving a map.
func TestValidateAcceptsCoordinatesWithoutAddress(t *testing.T) {
	r := valid()
	r.Address = ""
	if err := r.Validate(); err != nil {
		t.Fatalf("want nil, got %v", err)
	}
}

// The city's form counts UTF-16 code units, so this one does too. Counting
// bytes instead would turn away a description their form would have taken:
// Filipino and Cebuano carry accented characters, and an emoji is four bytes
// and two units.
func TestDescriptionIsCountedAsTheCityCountsIt(t *testing.T) {
	cases := map[string]struct {
		text string
		want int
	}{
		"plain ascii":     {"pothole", 7},
		"accented letter": {"ná", 2},
		"emoji":           {"🕳", 2},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			if got := DescriptionLength(c.text); got != c.want {
				t.Fatalf("DescriptionLength(%q) = %d, want %d", c.text, got, c.want)
			}
		})
	}
}

// A description at the limit in the city's count goes through, even though
// its bytes run well past it.
func TestValidateAcceptsAccentedTextUpToTheLimit(t *testing.T) {
	r := valid()
	r.Description = strings.Repeat("á", MaxDescription)
	if err := r.Validate(); err != nil {
		t.Fatalf("want nil, got %v", err)
	}
	r.Description = strings.Repeat("á", MaxDescription+1)
	if err := r.Validate(); err == nil {
		t.Fatal("want an error one character over the limit, got nil")
	}
}
