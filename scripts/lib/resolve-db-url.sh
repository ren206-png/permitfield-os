# shellcheck shell=bash
#
# Shared by scripts/run-sql-tests.sh and scripts/run-client-portal-sql-tests.sh
# (sourced, not executed). Resolves the Postgres URL of a running local
# Supabase stack.
#
# Usage: resolve_db_url <override-var-name> [supabase global args...]
#   e.g. DB_URL="$(resolve_db_url DB_URL)"
#        DB_URL="$(resolve_db_url CLIENT_PORTAL_DB_URL --workdir supabase-client-portal)"
#
# Tries, in order, stopping at the first non-empty result:
#   1. the environment variable named by <override-var-name>, if set --
#      lets a caller point the suite at a database explicitly and skip the
#      CLI entirely;
#   2. `supabase status -o env`, the original and still-preferred source;
#   3. `supabase status -o json`, then plain `supabase status`, parsed with
#      node. The CLI's status output format has shifted between versions
#      (plain `status` prints a JSON object on 2.114.0), so a grep over one
#      format alone is not something to bet the whole suite on.
#
# Prints the URL on stdout (empty if nothing worked -- callers keep their
# own fail-loud check) and which source it came from on stderr. Never
# prints the URL itself to stderr: an override may carry a real password.

resolve_db_url() {
  local override_var="$1"
  shift
  local url

  url="${!override_var:-}"
  if [ -n "$url" ]; then
    echo "using database URL from \$$override_var" >&2
    printf '%s' "$url"
    return
  fi

  url="$(supabase ${1+"$@"} status -o env 2>/dev/null | grep '^DB_URL=' | head -n 1 | cut -d= -f2- | tr -d '"')"
  if [ -n "$url" ]; then
    echo "using DB_URL from 'supabase status -o env'" >&2
    printf '%s' "$url"
    return
  fi

  if ! command -v node >/dev/null 2>&1; then
    return
  fi

  local status_args
  for status_args in "-o json" ""; do
    # shellcheck disable=SC2086 # status_args is deliberately word-split
    url="$(supabase ${1+"$@"} status $status_args 2>/dev/null | _db_url_from_status_json)"
    if [ -n "$url" ]; then
      echo "using DB_URL from 'supabase status${status_args:+ $status_args}' (JSON)" >&2
      printf '%s' "$url"
      return
    fi
  done
}

# Reads `supabase status` output on stdin, prints its top-level DB_URL.
# Takes the span from the first "{" to the last "}" so a stray log line
# before or after the JSON object doesn't break the parse.
_db_url_from_status_json() {
  node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const i = s.indexOf("{");
      const j = s.lastIndexOf("}");
      if (i < 0 || j < i) return;
      try {
        const v = JSON.parse(s.slice(i, j + 1)).DB_URL;
        if (typeof v === "string") process.stdout.write(v);
      } catch {}
    });
  '
}
