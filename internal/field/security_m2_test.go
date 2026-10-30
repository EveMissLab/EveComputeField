package field

import "testing"

func TestM2RejectsWindowsUnsafeNames(t *testing.T) {
	for _, name := range []string{".", "..", "name.", "CON", "nul", "COM1", "LPT9", "aux.txt"} {
		s := Spec{Version: ProtocolVersion, FieldID: name, UnitCount: 1}
		if err := s.Validate(); err == nil {
			t.Errorf("accepted unsafe field id %q", name)
		}
	}
	s := Spec{Version: ProtocolVersion, FieldID: "good.field", UnitCount: 1}
	if err := s.Validate(); err != nil {
		t.Fatalf("safe field rejected: %v", err)
	}
}
