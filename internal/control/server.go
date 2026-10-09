// internal/holonet/server.go
// purpose: 
// author: daniel daum
package

import (
	"fmt"
	"net/http"

	"git.danieldaum.net/daniel-daum/holonet/internal/config"
)

// setup control pane http server
// pull and provide configs
func holonet() *http.Server {
	settings := config.LoadSettings()

	fmt.Printf("HOST IS SET: %s\n", settings.HOST)
	fmt.Printf("PORT IS SET: %s\n", settings.PORT)
	fmt.Printf("ENV IS SET: %s\n", settings.ENV)

	fmt.Println("STARTING SERVER")
	s := &http.Server{}

	return s
}

// start server
// wrap in graceful shutdown
func Serve() {

	holonet().ListenAndServe()
}
