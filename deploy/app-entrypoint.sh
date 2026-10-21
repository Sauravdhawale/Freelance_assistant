#!/bin/sh
set -eu
node backend/src/migrate.js
exec node backend/src/server.js
