// Package champions loads the League of Legends champion roster from
// Riot's Data Dragon CDN. The icon files themselves are loaded by the
// browser directly; this package only deals with the metadata.
package champions

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"time"
)

const (
	versionsURL    = "https://ddragon.leagueoflegends.com/api/versions.json"
	championsTmpl  = "https://ddragon.leagueoflegends.com/cdn/%s/data/en_US/champion.json"
	excludedChamp  = "Yuumi"
	requestTimeout = 15 * time.Second
)

// Champion is the minimal metadata the frontend needs to display a champion.
// ID is the Data Dragon identifier (e.g. "Aatrox") used to build the icon URL.
type Champion struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Pool is the result of a Data Dragon load: a patch version plus the
// filtered champion list, sorted by name for deterministic display.
type Pool struct {
	Version   string
	Champions []Champion
}

type ddragonChampions struct {
	Data map[string]struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"data"`
}

// Load fetches the latest patch version and full champion list from Data
// Dragon, filtering out Yuumi.
func Load(ctx context.Context) (*Pool, error) {
	client := &http.Client{Timeout: requestTimeout}

	version, err := fetchLatestVersion(ctx, client)
	if err != nil {
		return nil, fmt.Errorf("fetch versions: %w", err)
	}

	champs, err := fetchChampions(ctx, client, version)
	if err != nil {
		return nil, fmt.Errorf("fetch champions: %w", err)
	}

	return &Pool{Version: version, Champions: champs}, nil
}

func fetchLatestVersion(ctx context.Context, c *http.Client) (string, error) {
	var versions []string
	if err := getJSON(ctx, c, versionsURL, &versions); err != nil {
		return "", err
	}
	if len(versions) == 0 {
		return "", fmt.Errorf("empty versions list")
	}
	return versions[0], nil
}

func fetchChampions(ctx context.Context, c *http.Client, version string) ([]Champion, error) {
	var dr ddragonChampions
	if err := getJSON(ctx, c, fmt.Sprintf(championsTmpl, version), &dr); err != nil {
		return nil, err
	}
	out := make([]Champion, 0, len(dr.Data))
	for _, c := range dr.Data {
		if c.ID == excludedChamp {
			continue
		}
		out = append(out, Champion{ID: c.ID, Name: c.Name})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func getJSON(ctx context.Context, c *http.Client, url string, into any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := c.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status %d for %s", resp.StatusCode, url)
	}
	return json.NewDecoder(resp.Body).Decode(into)
}
