package device

import (
	"os"
	"strings"
	"sync"
)

var (
	streamDebugOnce sync.Once
	streamDebugOn   bool
)

func streamDebugEnabled() bool {
	streamDebugOnce.Do(func() {
		value := strings.TrimSpace(os.Getenv("AGENTLINE_BRIDGE_STREAM_DEBUG"))
		switch strings.ToLower(value) {
		case "1", "true", "yes", "on":
			streamDebugOn = true
		default:
			streamDebugOn = false
		}
	})
	return streamDebugOn
}
