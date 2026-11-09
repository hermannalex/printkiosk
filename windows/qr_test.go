package main

import (
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"strings"
	"testing"
)

// Writes PNGs for tools/check_qr.py (OpenCV decodes them and compares the text).
func TestWriteQRSamples(t *testing.T) {
	dir := os.Getenv("QR_OUT")
	if dir == "" {
		t.Skip("QR_OUT not set")
	}
	samples := []string{
		"WIFI:T:WPA;S:Loja;P:segredo123;;",
		"http://192.168.0.15:50123/u/abcd2345ef",
		"00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304" + strings.Repeat("A", 4),
		strings.Repeat("Quioco 0123456789 ", 12),
		strings.Repeat("x", 600),
	}
	var list []string
	for i, text := range samples {
		q, err := EncodeQR(text)
		if err != nil {
			t.Fatal(err)
		}
		scale, border := 8, 4
		dim := (q.size + border*2) * scale
		img := image.NewGray(image.Rect(0, 0, dim, dim))
		for y := 0; y < dim; y++ {
			for x := 0; x < dim; x++ {
				mx, my := x/scale-border, y/scale-border
				c := color.Gray{255}
				if mx >= 0 && my >= 0 && mx < q.size && my < q.size && q.modules[my][mx] {
					c = color.Gray{0}
				}
				img.SetGray(x, y, c)
			}
		}
		name := fmt.Sprintf("%s/qr%d.png", dir, i)
		f, _ := os.Create(name)
		png.Encode(f, img)
		f.Close()
		os.WriteFile(name+".txt", []byte(text), 0o644)
		list = append(list, fmt.Sprintf("%s v%d", name, (q.size-17)/4))
	}
	t.Log(strings.Join(list, "\n"))
}
