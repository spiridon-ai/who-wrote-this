# Libraries saved into the repo

Nothing is installed or downloaded when the page runs. These two files are copied in as they were
published; they are not edited.

| File | Library | Version | Licence | Downloaded from | SHA-256 |
|---|---|---|---|---|---|
| `fflate.js` | fflate (reads zip files) | 0.8.2 | MIT (`fflate.LICENSE.txt`) | https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js | `c3b34f2e9f5e74d4d7d64e01cac7a0c01954c6c406414d42185c7b53d6875ddf` |
| `xlsx.mini.min.js` | SheetJS Community Edition, mini build (reads Excel and CSV) | 0.20.3 | Apache-2.0 (`xlsx.LICENSE.txt`) | https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.mini.min.js | `0cb353f830d7288385492c83d277b058ddeac664ca51cf1393aa1fd3e2b70939` |

Why these: see `DECISIONS.md` D10 and D23. SheetJS is taken from its maker's own site because the
copy on npm stops at the older 0.18.5.

To check a file has not changed: `shasum -a 256 vendor/fflate.js vendor/xlsx.mini.min.js`.
