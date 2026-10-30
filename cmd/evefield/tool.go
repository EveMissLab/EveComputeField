package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"unicode/utf8"

	"github.com/EveMissLab/EveComputeField/internal/fluid"
	"github.com/EveMissLab/EveComputeField/internal/workload"
)

// toolCommand supplies a few deterministic local helpers that can be
// registered explicitly by the workstation owner as field workloads.
func toolCommand(args []string) error {
	if len(args) != 1 {
		return errors.New("tool requires sha256, uppercase, lines, or fluid")
	}
	raw, err := io.ReadAll(io.LimitReader(os.Stdin, workload.MaxInputBytes+1))
	if err != nil {
		return err
	}
	if len(raw) > workload.MaxInputBytes {
		return errors.New("tool input >64KiB")
	}
	switch args[0] {
	case "fluid":
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.DisallowUnknownFields()
		var config fluid.Config
		if e := dec.Decode(&config); e != nil {
			return e
		}
		var extra any
		if e := dec.Decode(&extra); e != io.EOF {
			return errors.New("trailing fluid input")
		}
		result, e := fluid.Run(config)
		if e != nil {
			return e
		}
		return json.NewEncoder(os.Stdout).Encode(result)
	case "sha256":
		sum := sha256.Sum256(raw)
		_, err = fmt.Fprintln(os.Stdout, hex.EncodeToString(sum[:]))
	case "uppercase":
		if !utf8.Valid(raw) {
			return errors.New("input must be valid UTF-8")
		}
		_, err = io.WriteString(os.Stdout, strings.ToUpper(string(raw)))
	case "lines":
		count := strings.Count(string(raw), "\n")
		if len(raw) != 0 && raw[len(raw)-1] != '\n' {
			count++
		}
		_, err = fmt.Fprintln(os.Stdout, count)
	default:
		return fmt.Errorf("unknown tool %q", args[0])
	}
	return err
}
