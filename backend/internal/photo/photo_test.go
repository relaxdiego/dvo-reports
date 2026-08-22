package photo

import (
	"bytes"
	"encoding/binary"
	"testing"
)

// The fixtures below are built by hand, little-endian, because a phone's
// files are little-endian and the filter writes big-endian. Building them
// with this package's own writer would test nothing about reading a file it
// did not produce.

const (
	// Invented, and obviously so. These stand for the two identifiers a
	// phone writes onto a capture. Real ones belong to a real photograph
	// somebody took, and this repository is public.
	dateTaken = "2025:09:07 09:16:00"
	requestID = "11111111-2222-4333-8444-555555555555"
	photoID   = "66666666-7777-4888-8999-AAAAAAAAAAAA"
)

type tag struct {
	id  uint16
	typ uint16
	cnt uint32
	val []byte // whole value, little-endian, however long
}

func ascii(s string) []byte { return append([]byte(s), 0) }

func le32(v uint32) []byte {
	b := make([]byte, 4)
	binary.LittleEndian.PutUint32(b, v)
	return b
}

func le16(v uint16) []byte {
	b := make([]byte, 2)
	binary.LittleEndian.PutUint16(b, v)
	return b
}

// rational is one little-endian RATIONAL: numerator then denominator.
func rational(num, den uint32) []byte { return append(le32(num), le32(den)...) }

// ifd renders a directory and the values too big to sit inside it. dataAt is
// where those values will land in the finished block.
func ifd(entries []tag, next, dataAt uint32) (dir, data []byte) {
	var d, extra bytes.Buffer
	d.Write(le16(uint16(len(entries))))
	for _, e := range entries {
		d.Write(le16(e.id))
		d.Write(le16(e.typ))
		d.Write(le32(e.cnt))
		if len(e.val) > 4 {
			d.Write(le32(dataAt + uint32(extra.Len())))
			extra.Write(e.val)
			if extra.Len()%2 == 1 {
				extra.WriteByte(0)
			}
		} else {
			v := make([]byte, 4)
			copy(v, e.val)
			d.Write(v)
		}
	}
	d.Write(le32(next))
	return d.Bytes(), extra.Bytes()
}

// appleBlob is Apple's private block: its own header, big-endian records, and
// offsets counted from the start of the block.
func appleBlob() []byte {
	entries := []tag{
		{0x0001, 9, 1, []byte{0, 0, 0, 15}}, // dropped: a version number
		{0x0020, 2, 37, ascii(requestID)},   // kept
		{0x002b, 2, 37, ascii(photoID)},     // kept
	}
	head := len(appleMakerNote)
	dataAt := uint32(head) + 2 + uint32(len(entries))*12
	var dir, data bytes.Buffer
	dir.Write(appleMakerNote)
	var n [2]byte
	binary.BigEndian.PutUint16(n[:], uint16(len(entries)))
	dir.Write(n[:])
	for _, e := range entries {
		var rec [12]byte
		binary.BigEndian.PutUint16(rec[0:], e.id)
		binary.BigEndian.PutUint16(rec[2:], e.typ)
		binary.BigEndian.PutUint32(rec[4:], e.cnt)
		if len(e.val) > 4 {
			binary.BigEndian.PutUint32(rec[8:], dataAt+uint32(data.Len()))
			data.Write(e.val)
			if data.Len()%2 == 1 {
				data.WriteByte(0)
			}
		} else {
			copy(rec[8:], e.val)
		}
		dir.Write(rec[:])
	}
	dir.Write(data.Bytes())
	return dir.Bytes()
}

// exifBlock builds a TIFF block shaped like a phone's: a main directory that
// names the camera, an Exif directory with settings and Apple's block, a GPS
// directory, and a second directory holding a thumbnail.
func exifBlock() []byte {
	mn := appleBlob()

	ifd0 := []tag{
		{0x010f, 2, 6, ascii("Apple")},
		{0x0110, 2, 14, ascii("iPhone 16 Pro")},
		{0x0112, 3, 1, le16(6)},
		{0x0131, 2, 7, ascii("18.6.2")},
		{0x0132, 2, 20, ascii(dateTaken)},
		{0x8769, 4, 1, nil}, // filled in below
		{0x8825, 4, 1, nil},
	}
	exif := []tag{
		{0x829a, 5, 1, rational(1, 302)},
		{0x9003, 2, 20, ascii(dateTaken)},
		{0x9010, 2, 7, ascii("+08:00")},
		{0xa002, 4, 1, le32(4032)},
		{0x927c, 7, uint32(len(mn)), mn},
	}
	gps := []tag{
		{0x0001, 2, 2, ascii("N")},
		{0x0002, 5, 3, bytes.Join([][]byte{rational(7, 1), rational(5, 1), rational(5112, 100)}, nil)},
		{0x0003, 2, 2, ascii("E")},
		{0x0004, 5, 3, bytes.Join([][]byte{rational(125, 1), rational(37, 1), rational(2025, 100)}, nil)},
		{0x001f, 5, 1, rational(1919, 100)},
	}
	thumb := []tag{
		{0x0103, 3, 1, le16(6)},
		{0x0201, 4, 1, le32(9000)},
		{0x0202, 4, 1, le32(64)},
	}

	size := func(n int) uint32 { return uint32(2 + 12*n + 4) }
	const head = 8
	ifd0At := uint32(head)
	exifAt := ifd0At + size(len(ifd0))
	gpsAt := exifAt + size(len(exif))
	thumbAt := gpsAt + size(len(gps))
	dataAt := thumbAt + size(len(thumb))

	ifd0[5].val = le32(exifAt)
	ifd0[6].val = le32(gpsAt)

	d0, x0 := ifd(ifd0, thumbAt, dataAt)
	dE, xE := ifd(exif, 0, dataAt+uint32(len(x0)))
	dG, xG := ifd(gps, 0, dataAt+uint32(len(x0)+len(xE)))
	dT, xT := ifd(thumb, 0, dataAt+uint32(len(x0)+len(xE)+len(xG)))

	var b bytes.Buffer
	b.Write([]byte{'I', 'I', 42, 0})
	b.Write(le32(head))
	b.Write(d0)
	b.Write(dE)
	b.Write(dG)
	b.Write(dT)
	b.Write(x0)
	b.Write(xE)
	b.Write(xG)
	b.Write(xT)
	return b.Bytes()
}

func segment(marker byte, body []byte) []byte {
	out := []byte{0xFF, marker, 0, 0}
	binary.BigEndian.PutUint16(out[2:], uint16(len(body)+2))
	return append(out, body...)
}

// phonePhoto is a JPEG carrying what a phone actually writes.
func phonePhoto() []byte {
	var b bytes.Buffer
	b.Write([]byte{0xFF, 0xD8})
	b.Write(segment(0xE0, append([]byte("JFIF\x00"), 1, 1, 0, 0, 72, 0, 72, 0, 0)))
	b.Write(segment(0xE1, append([]byte("Exif\x00\x00"), exifBlock()...)))
	b.Write(segment(0xE2, []byte("ICC_PROFILE\x00a colour profile")))
	b.Write(segment(0xE2, []byte("MPF\x00a second embedded image")))
	b.Write(segment(0xED, []byte("Photoshop 3.0\x00stuff")))
	b.Write(segment(0xFE, []byte("a comment nobody asked for")))
	b.Write(segment(0xDB, []byte("quantisation table")))
	b.Write([]byte{0xFF, 0xDA, 0x00, 0x08, 1, 1, 0, 0, 0, 0})
	b.Write([]byte("scan data pretending to be a picture"))
	b.Write([]byte{0xFF, 0xD9})
	return b.Bytes()
}

// markers lists the application and comment segments left in a JPEG.
func markers(img []byte) []byte {
	var out []byte
	for i := 2; i+4 <= len(img) && img[i] == 0xFF; {
		m := img[i+1]
		if m == 0xDA {
			break
		}
		n := int(binary.BigEndian.Uint16(img[i+2:]))
		if (m >= 0xE0 && m <= 0xEF) || m == 0xFE {
			out = append(out, m)
		}
		i += 2 + n
	}
	return out
}

func TestCleanKeepsOnlyTheNamedFields(t *testing.T) {
	got := Clean(phonePhoto())

	kept := []struct{ what, text string }{
		{"the date the photo was taken", dateTaken},
		{"the time offset", "+08:00"},
		{"the capture request identifier", requestID},
		{"the photo identifier", photoID},
	}
	for _, k := range kept {
		if !bytes.Contains(got, []byte(k.text)) {
			t.Errorf("%s was dropped, and should have been kept", k.what)
		}
	}

	dropped := []struct{ what, text string }{
		// Not "Apple": that word is also the signature of the private block
		// whose two identifiers are kept on purpose. The make is checked by
		// tag below, where it cannot be confused with anything else.
		{"the model", "iPhone 16 Pro"},
		{"the software version", "18.6.2"},
		{"the colour profile", "ICC_PROFILE"},
		{"the second embedded image", "MPF"},
		{"the Photoshop block", "Photoshop 3.0"},
		{"the comment", "a comment nobody asked for"},
	}
	for _, d := range dropped {
		if bytes.Contains(got, []byte(d.text)) {
			t.Errorf("%s survived, and should have been dropped", d.what)
		}
	}

	if !bytes.Contains(got, []byte("scan data pretending to be a picture")) {
		t.Error("the picture itself was damaged")
	}
	if !bytes.Contains(got, []byte("quantisation table")) {
		t.Error("a segment the decoder needs was dropped")
	}
	// APP0 stays because a JFIF header is structural. Everything else goes.
	if m := markers(got); !bytes.Equal(m, []byte{0xE0, 0xE1}) {
		t.Errorf("segments left = %#v, want APP0 and APP1 only", m)
	}
}

// The tag lists are the whole policy, so they are asserted exactly. A tag
// that appears here without being added on purpose is a leak.
func TestCleanWritesExactlyTheKeptTags(t *testing.T) {
	tiff := exifOf(t, Clean(phonePhoto()))
	root := readDir(tiff, binary.BigEndian.Uint32(tiff[4:]))

	// DateTime, and the pointers to the two directories below.
	wantTags(t, "the main directory", root, 0x0132, tagExifIFD, tagGPSIFD)

	exif := readDir(tiff, binary.BigEndian.Uint32(root[tagExifIFD]))
	// DateTimeOriginal, OffsetTime, and Apple's block. No exposure setting,
	// and no pixel dimensions describing the photo before it was resized.
	wantTags(t, "the Exif directory", exif, 0x9003, 0x9010, tagMakerNote)

	gps := readDir(tiff, binary.BigEndian.Uint32(root[tagGPSIFD]))
	wantTags(t, "the GPS directory", gps, 0x0001, 0x0002, 0x0003, 0x0004, 0x001f)

	mn := exif[tagMakerNote]
	if !bytes.HasPrefix(mn, appleMakerNote) {
		t.Fatal("the rebuilt private block lost Apple's signature, so no reader will find it")
	}
	if n := binary.BigEndian.Uint16(mn[len(appleMakerNote):]); n != 2 {
		t.Errorf("the private block holds %d records, want exactly the 2 identifiers", n)
	}
}

func wantTags(t *testing.T, what string, got map[uint16][]byte, want ...uint16) {
	t.Helper()
	for _, w := range want {
		if _, ok := got[w]; !ok {
			t.Errorf("%s is missing tag 0x%04x", what, w)
		}
	}
	for g := range got {
		found := false
		for _, w := range want {
			if g == w {
				found = true
			}
		}
		if !found {
			t.Errorf("%s carries tag 0x%04x, which nothing asked to keep", what, g)
		}
	}
}

func TestCleanKeepsThePositionExactly(t *testing.T) {
	got := Clean(phonePhoto())
	tiff := exifOf(t, got)

	gps := gpsOf(t, tiff)
	// 7 deg 5' 51.12" N, 125 deg 37' 20.25" E, to the last digit.
	want := map[uint16][]uint32{
		0x0002: {7, 1, 5, 1, 5112, 100},
		0x0004: {125, 1, 37, 1, 2025, 100},
		0x001f: {1919, 100},
	}
	for tagID, nums := range want {
		v, ok := gps[tagID]
		if !ok {
			t.Fatalf("GPS tag 0x%04x is missing", tagID)
		}
		if len(v) != len(nums)*4 {
			t.Fatalf("GPS tag 0x%04x is %d bytes, want %d", tagID, len(v), len(nums)*4)
		}
		for i, n := range nums {
			// The filter writes big-endian, whatever the phone used.
			if g := binary.BigEndian.Uint32(v[i*4:]); g != n {
				t.Errorf("GPS tag 0x%04x part %d = %d, want %d", tagID, i, g, n)
			}
		}
	}
	if _, ok := gps[0x0001]; !ok {
		t.Error("the north/south marker was dropped, which flips the position")
	}
}

func TestCleanDropsTheThumbnail(t *testing.T) {
	tiff := exifOf(t, Clean(phonePhoto()))
	// The thumbnail hangs off the main directory's "next" pointer. A second
	// copy of the picture is still the picture.
	n := binary.BigEndian.Uint16(tiff[8:])
	next := binary.BigEndian.Uint32(tiff[8+2+uint32(n)*12:])
	if next != 0 {
		t.Errorf("a second directory is still chained at %d", next)
	}
}

func TestCleanLeavesAPhotoWithNothingWorthKeeping(t *testing.T) {
	var b bytes.Buffer
	b.Write([]byte{0xFF, 0xD8})
	b.Write(segment(0xE1, []byte("Exif\x00\x00II*\x00\x08\x00\x00\x00\x00\x00\x00\x00\x00\x00")))
	b.Write([]byte{0xFF, 0xDA, 0x00, 0x08, 1, 1, 0, 0, 0, 0})
	b.Write([]byte("pixels"))
	got := Clean(b.Bytes())
	if m := markers(got); len(m) != 0 {
		t.Errorf("segments left = %#v, want none: an empty block is not worth writing", m)
	}
	if !bytes.Contains(got, []byte("pixels")) {
		t.Error("the picture itself was damaged")
	}
}

func TestCleanLeavesWhatIsNotAJPEGAlone(t *testing.T) {
	in := []byte("\x89PNG\r\n\x1a\n and then some")
	if got := Clean(in); !bytes.Equal(got, in) {
		t.Error("a file that is not a JPEG was changed")
	}
}

func TestCleanSurvivesRubbish(t *testing.T) {
	// Truncated, lying about its own lengths, or simply not an image. None of
	// it may panic: this runs on whatever a stranger uploads.
	whole := phonePhoto()
	cases := [][]byte{
		{},
		{0xFF},
		{0xFF, 0xD8},
		{0xFF, 0xD8, 0xFF, 0xE1, 0xFF, 0xFF},
		{0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x08, 'E', 'x', 'i', 'f', 0, 0},
		append([]byte{0xFF, 0xD8}, segment(0xE1, []byte("Exif\x00\x00MM\x00\x2a\xff\xff\xff\xff"))...),
		whole[:len(whole)/2],
		whole[:len(whole)/4],
	}
	for i, c := range cases {
		func() {
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("case %d panicked: %v", i, r)
				}
			}()
			Clean(c)
		}()
	}
}

// exifOf returns the TIFF block inside the cleaned image's Exif segment.
func exifOf(t *testing.T, img []byte) []byte {
	t.Helper()
	for i := 2; i+4 <= len(img) && img[i] == 0xFF; {
		m := img[i+1]
		if m == 0xDA {
			break
		}
		n := int(binary.BigEndian.Uint16(img[i+2:]))
		if m == 0xE1 && bytes.HasPrefix(img[i+4:], []byte("Exif\x00\x00")) {
			return img[i+10 : i+2+n]
		}
		i += 2 + n
	}
	t.Fatal("the cleaned photo has no Exif segment")
	return nil
}

// readDir reads one directory out of a big-endian TIFF block.
func readDir(tiff []byte, off uint32) map[uint16][]byte {
	out := map[uint16][]byte{}
	n := uint32(binary.BigEndian.Uint16(tiff[off:]))
	for i := uint32(0); i < n; i++ {
		rec := tiff[off+2+i*12:]
		id := binary.BigEndian.Uint16(rec)
		typ := binary.BigEndian.Uint16(rec[2:])
		cnt := binary.BigEndian.Uint32(rec[4:])
		size := typeSize[typ] * cnt
		if size > 4 {
			p := binary.BigEndian.Uint32(rec[8:])
			out[id] = tiff[p : p+size]
		} else {
			out[id] = rec[8 : 8+size]
		}
	}
	return out
}

// gpsOf reads the GPS directory out of a big-endian TIFF block.
func gpsOf(t *testing.T, tiff []byte) map[uint16][]byte {
	t.Helper()
	root := readDir(tiff, binary.BigEndian.Uint32(tiff[4:]))
	p, ok := root[tagGPSIFD]
	if !ok {
		t.Fatal("the cleaned photo has no GPS directory")
	}
	return readDir(tiff, binary.BigEndian.Uint32(p))
}
