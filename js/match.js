/*
 * Matches the names students typed into Padlet posts against a pasted class list.
 *
 * Plain code, no AI, no library (DECISIONS.md D2). The rules, in the order they are applied:
 *
 *   1. The author comes first (D30). "Display Name (username)" is a logged-in account: the post
 *      belongs to that account and the title is not used. Any other author is a guest, and both
 *      the author text and the title are searched for names.
 *   2. Names are normalised the same way on both sides (D15): case, punctuation and word order
 *      are ignored; accents are stripped on Latin letters only; other scripts stay as typed.
 *      A number is never a name word. One-letter words and particles ("de", "van") never count
 *      as a name on their own (D40).
 *   3. How strongly a text points at a student, strongest first:
 *        FULL_EXACT  every word of the name, next to each other, spelled exactly.
 *        FULL_TYPO   the same, with a typo forgiven in at least one word (Latin script only).
 *        ALONE       part of the name standing alone (the whole text, or the part before or
 *                    after a dash, colon or comma), spelled exactly (D29).
 *        WEAK        a name word inside a longer phrase, or a near spelling. Never a match.
 *   4. Never a silent guess (D3, D40):
 *        - one FULL_EXACT student wins, unless the post also names a second student;
 *        - with no FULL_EXACT, FULL_TYPO and ALONE are equals: one student is a match (labelled
 *          "close spelling", "first name only"...), two or more is "needs a look";
 *        - WEAK alone is "needs a look"; nothing at all is unmatched.
 *
 * Plain script, no build step: in the browser it adds to the global `WhoWroteThis`; in Node it
 * is loaded with require().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.WhoWroteThis = Object.assign(root.WhoWroteThis || {}, factory());
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- The cut-offs and word lists. Change them here. ----------

  // How many wrong, missing, extra or swapped letters a Latin-script word may have and still
  // count as the same word. Judged on the longer of the two words. Short words get no slack:
  // "Kent" must not become "Khan".
  var LATIN_SLACK = [
    { upToLength: 4, edits: 0 },
    { upToLength: 8, edits: 1 },
    { upToLength: Infinity, edits: 2 }
  ];
  // In other scripts a near spelling never matches; it only sends the post to "needs a look" (D31).
  var NON_LATIN_NEAR = [
    { upToLength: 2, edits: 0 },
    { upToLength: Infinity, edits: 1 }
  ];
  // Latin letters that are not "a letter plus an accent" in Unicode, folded by hand.
  var LATIN_FOLDS = { 'ø': 'o', 'đ': 'd', 'ł': 'l', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ı': 'i', 'ð': 'd', 'þ': 'th' };
  // Small words inside names that never count as a name on their own.
  var PARTICLES = ['de', 'del', 'della', 'di', 'da', 'do', 'dos', 'das', 'la', 'las', 'le', 'los', 'du', 'des',
    'el', 'al', 'van', 'von', 'der', 'den', 'ten', 'ter', 'bin', 'ibn', 'bint', 'abu', 'st'];
  // Joining words dropped from what is left of a title once a full name has been found in it.
  var JOINING_WORDS = ['and', 'et', 'und', 'with'];
  // A first line made only of these words is a header row, not a student.
  var HEADER_WORDS = ['name', 'names', 'first', 'last', 'full', 'given', 'family', 'surname', 'forename', 'middle',
    'student', 'students', 'pupil', 'pupils', 'id', 'no', 'number', 'email', 'class',
    'nombre', 'nombres', 'apellido', 'apellidos', 'alumno', 'alumna', 'prenom', 'nom', 'vorname', 'nachname'];
  // A title is cut into blocks at a dash with a space beside it, a long dash, a colon or a bracket...
  var BLOCK_SEPARATOR = /\s[-‐‑‒]+|[-‐‑‒]+\s|[–—―:：()\[\]（）]/u;
  // ...and each block into parts at a comma or semicolon.
  var PART_SEPARATOR = /[,;،؛，、]/u;
  // Scripts written without spaces between words: names are compared with spaces removed.
  // (Script_Extensions, so that marks shared by these scripts, like the Japanese long-vowel mark, count.)
  var NO_SPACE_SCRIPT = /^[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Thai}\p{scx=Lao}\p{scx=Khmer}\p{scx=Myanmar}\p{M}\s]+$/u;
  // Characters nobody can see: zero-width spaces and joiners, emoji variation selectors.
  var INVISIBLE = /[​-‍⁠﻿︀-️]/g;

  var FULL_EXACT = 4, FULL_TYPO = 3, ALONE = 2, WEAK = 1;

  var REASON_SEVERAL = 'More than one student fits this name.';
  var REASON_TWO_NAMES = 'More than one student is named in this post.';
  var REASON_WEAK = 'Part of a name appears here, or a name is spelled a little differently.';

  // ---------- Normalising ----------

  function normaliseName(text) {
    // NFKD also turns full-width letters and other look-alike forms into the ordinary ones.
    var decomposed = String(text == null ? '' : text).replace(INVISIBLE, '').normalize('NFKD');
    var out = '';
    var afterLatinLetter = false;
    for (var ch of decomposed) {
      if (/\p{M}/u.test(ch)) {
        if (!afterLatinLetter) out += ch; // an accent on a Latin letter is dropped; other marks stay
        continue;
      }
      afterLatinLetter = /\p{Script=Latin}/u.test(ch);
      out += ch;
    }
    return out.normalize('NFC').toLowerCase()
      .replace(/[øđłßæœıðþ]/g, function (letter) { return LATIN_FOLDS[letter]; })
      .replace(/['’ʼ`]s(?![\p{L}\p{N}])/gu, '') // "Charlotte's" -> "charlotte"
      .replace(/['’ʼ`]/g, '') // "O'Brien" -> "obrien"
      .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
      .trim();
  }

  // Text -> its words. A word that is only digits is dropped: a number is never a name word.
  function wordsOf(text) {
    return normaliseName(text).split(' ').filter(function (word) {
      return word !== '' && !/^\p{N}+$/u.test(word);
    });
  }

  function isLatinWord(word) {
    return /^[\p{Script=Latin}\p{N}]+$/u.test(word);
  }

  function lengthOf(word) {
    return Array.from(word).length;
  }

  // False for a one-letter Latin word and for a particle: neither counts as a name on its own.
  function countsAsName(word) {
    if (isLatinWord(word) && lengthOf(word) === 1) return false;
    return PARTICLES.indexOf(word) === -1;
  }

  function allowedEdits(table, length) {
    for (var i = 0; i < table.length; i++) {
      if (length <= table[i].upToLength) return table[i].edits;
    }
    return 0;
  }

  // Edit distance where swapping two neighbouring letters counts as one edit.
  function editDistance(a, b) {
    var s = Array.from(a), t = Array.from(b);
    var previous2 = null, previous = [], current;
    for (var j = 0; j <= t.length; j++) previous[j] = j;
    for (var i = 1; i <= s.length; i++) {
      current = [i];
      for (j = 1; j <= t.length; j++) {
        var cost = s[i - 1] === t[j - 1] ? 0 : 1;
        current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
        if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
          current[j] = Math.min(current[j], previous2[j - 2] + 1);
        }
      }
      previous2 = previous;
      previous = current;
    }
    return previous[t.length];
  }

  // 'exact', 'near' (a Latin word within its slack), 'near-other-script', or null.
  function compareWords(a, b) {
    if (a === b) return 'exact';
    var longest = Math.max(lengthOf(a), lengthOf(b));
    var latin = isLatinWord(a) && isLatinWord(b);
    var edits = allowedEdits(latin ? LATIN_SLACK : NON_LATIN_NEAR, longest);
    if (edits === 0 || Math.abs(lengthOf(a) - lengthOf(b)) > edits) return null;
    if (editDistance(a, b) > edits) return null;
    return latin ? 'near' : 'near-other-script';
  }

  // ---------- The class list ----------

  /*
   * One student per line. A tab inside a line counts as a space (a two-column paste from a
   * spreadsheet). A semicolon separates students; a comma never does, because it means
   * "Last, First". But a line with three or more comma-separated parts is a list of students,
   * and is split (D44). Dropped and counted: blank lines, a header row, cells that are only
   * digits (an ID), email addresses. List numbering ("1. ", "2) ") is stripped. Duplicates are
   * kept: two students with the same name are two students (D26, D27, D40).
   */
  function parseClassList(text) {
    var students = [];
    var dropped = { blankLines: 0, idCells: 0, emailCells: 0, headerRows: 0, commaLines: 0, namesFromCommaLines: 0 };
    var lines = String(text == null ? '' : text).split(/\r\n|\r|\n/);
    if (lines.length === 1 && lines[0].trim() === '') lines = [];
    var seenFirstLine = false;
    lines.forEach(function (line, lineIndex) {
      if (line.trim() === '') { dropped.blankLines++; return; }
      if (!seenFirstLine) {
        seenFirstLine = true;
        var words = wordsOf(line);
        if (words.length > 0 && words.every(function (word) { return HEADER_WORDS.indexOf(word) !== -1; })) {
          dropped.headerRows++;
          return;
        }
      }
      // One entry -> one student (or none, if nothing but numbers and emails is left of it).
      function addStudent(entry) {
        var cells = entry.split('\t').map(function (cell) {
          return cell.split(/\s+/).filter(function (piece) {
            if (piece.indexOf('@') !== -1) { dropped.emailCells++; return false; }
            return true;
          }).join(' ').trim();
        }).filter(function (cell) {
          if (/^\d+$/.test(cell)) { dropped.idCells++; return false; }
          return cell !== '';
        });
        var name = cells.join(' ').replace(/\s+/g, ' ').replace(/^\d+\s*[.)\-:]*\s*/, '').trim();
        if (wordsOf(name).length === 0) return false;
        students.push(makeStudent(students.length, name, lineIndex + 1));
        return true;
      }
      line.split(';').forEach(function (entry) {
        var parts = entry.split(',').filter(function (part) { return part.trim() !== ''; });
        if (parts.length < 3) { addStudent(entry); return; } // one name, or "Last, First"
        dropped.commaLines++;
        parts.forEach(function (part) { if (addStudent(part)) dropped.namesFromCommaLines++; });
      });
    });
    return { students: students, dropped: dropped };
  }

  function makeStudent(id, name, line) {
    var student = { id: id, name: name, line: line };
    if (NO_SPACE_SCRIPT.test(normaliseName(name))) {
      student.words = [wordsOf(name).join('')];
      student.roles = ['whole'];
      student.noSpaces = true;
      return student;
    }
    var comma = name.indexOf(',');
    if (comma !== -1) { // "Last, First"
      var family = wordsOf(name.slice(0, comma)), given = wordsOf(name.slice(comma + 1));
      student.words = family.concat(given);
      student.roles = family.map(function () { return 'family'; }).concat(given.map(function () { return 'given'; }));
    } else { // "First Middle Last"
      student.words = wordsOf(name);
      student.roles = student.words.map(function (word, i) {
        if (i === 0) return 'given';
        return i === student.words.length - 1 ? 'family' : 'other';
      });
    }
    return student;
  }

  function labelFor(roles) {
    if (roles.every(function (role) { return role === 'given'; })) return 'first name only';
    if (roles.every(function (role) { return role === 'family'; })) return 'surname only';
    return 'part of name only';
  }

  // ---------- Reading a text ----------

  /*
   * A title or an author name -> its blocks. Each block is { words, parts }:
   *   words = the block's words in order;
   *   parts = [start, end) ranges of `words`, one per comma-separated part.
   */
  function blocksOf(text) {
    return String(text == null ? '' : text).split(BLOCK_SEPARATOR).map(function (rawBlock) {
      var words = [], parts = [];
      rawBlock.split(PART_SEPARATOR).forEach(function (rawPart) {
        var partWords = wordsOf(rawPart);
        if (partWords.length === 0) return;
        parts.push([words.length, words.length + partWords.length]);
        words = words.concat(partWords);
      });
      return { words: words, parts: parts };
    }).filter(function (block) { return block.words.length > 0; });
  }

  // The stretches of words in which a name can "stand alone": the whole text, each block, each part.
  function unitsOf(blocks) {
    var units = [blocks.reduce(function (all, block) { return all.concat(block.words); }, [])];
    blocks.forEach(function (block) {
      units.push(block.words);
      block.parts.forEach(function (range) { units.push(block.words.slice(range[0], range[1])); });
    });
    return units.filter(function (unit) { return unit.length > 0; });
  }

  // What is left of the blocks once the words [start, end) of block `at` are taken out.
  // Joining words ("and") and one-letter words are dropped from what is left.
  function blocksWithout(blocks, at, start, end) {
    var keep = function (word) { return JOINING_WORDS.indexOf(word) === -1 && countsAsName(word); };
    var left = [];
    blocks.forEach(function (block, i) {
      if (i !== at) { left.push(block); return; }
      var before = block.words.slice(0, start).filter(keep), after = block.words.slice(end).filter(keep);
      block.parts.forEach(function (range) { // parts that do not touch the name stay as they are
        if (range[1] <= start || range[0] >= end) left.push({ words: block.words.slice(range[0], range[1]).filter(keep), parts: [] });
      });
      if (before.length > 0) left.push({ words: before, parts: [] });
      if (after.length > 0) left.push({ words: after, parts: [] });
    });
    return left.filter(function (block) { return block.words.length > 0; });
  }

  // ---------- Matching ----------

  function createMatcher(students) {
    // Every distinct word in the class list, and which students have it.
    var studentsByWord = new Map();
    students.forEach(function (student) {
      if (student.noSpaces) return;
      student.words.forEach(function (word) {
        if (!studentsByWord.has(word)) studentsByWord.set(word, []);
        studentsByWord.get(word).push(student);
      });
    });
    var classWords = Array.from(studentsByWord.keys());
    var noSpaceStudents = students.filter(function (student) { return student.noSpaces; });

    // A word from a post -> the class-list words it is the same as, with how ('exact', 'near'...).
    // Remembered, because the same words come up in post after post.
    var remembered = new Map();
    function sameAs(postWord) {
      if (!remembered.has(postWord)) {
        var found = new Map();
        classWords.forEach(function (classWord) {
          var how = compareWords(classWord, postWord);
          if (how) found.set(classWord, how);
        });
        remembered.set(postWord, found);
      }
      return remembered.get(postWord);
    }

    // Can every one of `names` be paired with a different one of `postWords`? Returns null, or
    // 'exact' / 'near' / 'near-other-script': the weakest kind of likeness that was needed.
    function pairUp(names, postWords) {
      var used = [], weakest = 'exact';
      var rank = { 'exact': 0, 'near': 1, 'near-other-script': 2 };
      var ok = names.every(function (name) {
        var best = -1, bestHow = null;
        for (var i = 0; i < postWords.length; i++) {
          if (used[i]) continue;
          var how = sameAs(postWords[i]).get(name);
          if (how && (bestHow === null || rank[how] < rank[bestHow])) { best = i; bestHow = how; }
        }
        if (best === -1) return false;
        used[best] = true;
        if (rank[bestHow] > rank[weakest]) weakest = bestHow;
        return true;
      });
      return ok ? weakest : null;
    }

    // The student's whole name as neighbouring words of one block. Returns the best place found
    // as { how, block, start, end }, or null. An exact place is preferred, then a typo.
    function findFullName(names, blocks) {
      var rank = { 'exact': 0, 'near': 1, 'near-other-script': 2 };
      var found = null;
      blocks.forEach(function (block, at) {
        for (var start = 0; start + names.length <= block.words.length; start++) {
          var how = pairUp(names, block.words.slice(start, start + names.length));
          if (how && (found === null || rank[how] < rank[found.how])) {
            found = { how: how, block: at, start: start, end: start + names.length };
          }
        }
      });
      return found;
    }

    // Blocks -> what they say about each student: Map of student id -> { level, roles, place }.
    // `inside` collects no-space-script students whose whole name sits inside a longer run.
    function readBlocks(blocks) {
      var evidence = new Map(), inside = [];
      function note(student, level, extra) {
        var had = evidence.get(student.id);
        if (!had || level > had.level) evidence.set(student.id, Object.assign({ level: level, roles: [] }, extra || {}));
      }
      var units = unitsOf(blocks);
      if (units.length === 0) return { evidence: evidence, inside: inside };
      var allWords = units[0];

      // Students worth a closer look: any who share a word (exactly or nearly) with the text.
      var candidates = new Set();
      allWords.forEach(function (postWord) {
        sameAs(postWord).forEach(function (how, classWord) {
          studentsByWord.get(classWord).forEach(function (student) { candidates.add(student); });
        });
      });

      candidates.forEach(function (student) {
        var names = student.words;
        var hasRealWord = names.some(countsAsName);
        if (names.length >= 2 && hasRealWord) {
          var place = findFullName(names, blocks);
          if (place && place.how === 'exact') return note(student, FULL_EXACT, { place: place });
          if (place && place.how === 'near') return note(student, FULL_TYPO, { place: place });
          if (place) note(student, WEAK); // the whole name, with a near spelling in another script
        }
        // A one-word class-list name counts in full only when it stands alone, spelled exactly.
        if (names.length === 1 && hasRealWord && units.some(function (unit) { return unit.length === 1 && unit[0] === names[0]; })) {
          return note(student, FULL_EXACT);
        }
        // ALONE: a unit made only of words of this name, spelled exactly, but not the whole name.
        for (var u = 0; u < units.length; u++) {
          var unit = units[u];
          if (unit.length >= names.length || !unit.some(countsAsName)) continue;
          var roles = [], taken = [];
          var allExact = unit.every(function (postWord) {
            var at = names.findIndex(function (name, i) { return !taken[i] && name === postWord; });
            if (at === -1) return false;
            taken[at] = true; roles.push(student.roles[at]);
            return true;
          });
          if (allExact) return note(student, ALONE, { roles: roles });
        }
        // WEAK: an exactly spelled name word somewhere in the text...
        var exactWord = allWords.some(function (postWord) { return countsAsName(postWord) && names.indexOf(postWord) !== -1; });
        // ...or a unit that is nothing but near spellings of this name's words.
        var nearAlone = units.some(function (unit) {
          return unit.length <= names.length && unit.some(countsAsName) && unit.every(function (postWord) {
            return names.some(function (name) { return sameAs(postWord).has(name); });
          });
        });
        if (exactWord || nearAlone) note(student, WEAK);
      });

      // Scripts without spaces: compare with the spaces taken out.
      if (noSpaceStudents.length > 0) {
        var compactUnits = units.map(function (unit) { return unit.join(''); });
        noSpaceStudents.forEach(function (student) {
          var name = student.words[0];
          if (compactUnits.indexOf(name) !== -1) return note(student, FULL_EXACT);
          if (compactUnits[0].indexOf(name) !== -1) { inside.push(student.id); return note(student, WEAK); }
          if (compactUnits.some(function (unit) { return compareWords(name, unit) !== null; })) note(student, WEAK);
        });
      }
      return { evidence: evidence, inside: inside };
    }

    function idsAt(evidence, level) {
      var ids = [];
      evidence.forEach(function (found, id) { if (found.level === level) ids.push(id); });
      return ids;
    }

    function sorted(ids) {
      return Array.from(new Set(ids)).sort(function (a, b) { return a - b; });
    }

    // Does the post name a second student besides `winner`? Looks at what is left of the text the
    // winner's name was found in, and at any other text that says nothing about the winner.
    function othersNamed(winnerId, texts) {
      var others = [];
      texts.forEach(function (text) {
        var own = text.read.evidence.get(winnerId);
        var blocks;
        if (own && own.place) blocks = blocksWithout(text.blocks, own.place.block, own.place.start, own.place.end);
        else if (own && own.level >= ALONE) return; // this text is about the winner; nothing left over
        else blocks = text.blocks;
        readBlocks(blocks).evidence.forEach(function (found, id) {
          if (id !== winnerId && found.level >= ALONE) others.push(id);
        });
      });
      return others;
    }

    // The texts of one post -> matched, needs a look, or nothing.
    function decide(texts) {
      var evidence = new Map(), inside = [];
      texts.forEach(function (text) {
        text.read.evidence.forEach(function (found, id) {
          var had = evidence.get(id);
          if (!had || found.level > had.level) evidence.set(id, found);
        });
        inside = inside.concat(text.read.inside);
      });
      var exact = idsAt(evidence, FULL_EXACT);
      var next = idsAt(evidence, FULL_TYPO).concat(idsAt(evidence, ALONE));
      var weak = idsAt(evidence, WEAK);
      // A no-space name inside a longer run is a second name in the post, unless it is simply
      // part of the one fully matched name (王芳 inside 王芳芳).
      var alsoNamed = inside.filter(function (id) {
        if (exact.length !== 1) return true;
        var top = students[exact[0]];
        return !(top.noSpaces && top.words[0].indexOf(students[id].words[0]) !== -1);
      });
      var look = function (ids, reason) {
        return { status: 'needs-look', studentId: null, label: '', candidateIds: sorted(ids), reason: reason };
      };
      // Where the winning name was found: 'title', 'author' (a guest typed it when Padlet asked
      // who they were) or 'account' (a logged-in account). The title is named if it is in both.
      var foundIn = function (id) {
        var level = evidence.get(id).level;
        var sources = texts.filter(function (text) {
          var own = text.read.evidence.get(id);
          return own && own.level === level;
        }).map(function (text) { return text.source; });
        return sources.indexOf('title') !== -1 ? 'title' : sources[0];
      };
      var matched = function (id, label) {
        return { status: 'matched', studentId: id, label: label, candidateIds: [], reason: '', via: foundIn(id) };
      };

      if (exact.length > 1) return look(exact.concat(alsoNamed), REASON_SEVERAL);
      if (exact.length === 1) {
        var second = alsoNamed.concat(othersNamed(exact[0], texts));
        return second.length === 0 ? matched(exact[0], '') : look(exact.concat(second), REASON_TWO_NAMES);
      }
      if (next.length === 1 && alsoNamed.length === 0) {
        var found = evidence.get(next[0]);
        return matched(next[0], found.level === FULL_TYPO ? 'close spelling' : labelFor(found.roles));
      }
      if (next.length >= 1) return look(next.concat(alsoNamed), REASON_SEVERAL);
      if (weak.length >= 1) return look(weak, REASON_WEAK);
      return { status: 'unmatched', studentId: null, label: '', candidateIds: [], reason: '' };
    }

    function readText(text, source) {
      var blocks = blocksOf(text);
      return { blocks: blocks, read: readBlocks(blocks), source: source };
    }

    function matchPost(post) {
      var author = String(post && post.author != null ? post.author : '');
      var title = String(post && post.title != null ? post.title : '');
      // A logged-in account is exported as "Display Name (username)": a bracket at the very end
      // holding one word. Anything else is a guest, whatever they typed (D40).
      var account = /^(.*\S)\s+\(([^\s()]+)\)$/.exec(author.trim());
      var result;
      if (account) {
        result = decide([readText(account[1], 'account')]);
        // An account either fits a student or it is simply not on the class list.
        if (result.status === 'unmatched' || (result.status === 'needs-look' && result.reason === REASON_WEAK)) {
          result = { status: 'account', studentId: null, label: '', candidateIds: [], reason: '' };
        }
        result.account = author;
      } else {
        result = decide([readText(author, 'author'), readText(title, 'title')]);
      }
      result.post = post;
      return result;
    }

    return { matchPost: matchPost };
  }

  function matchPosts(posts, students) {
    var matcher = createMatcher(students);
    return posts.map(matcher.matchPost);
  }

  // ---------- The lists the teacher sees ----------

  /*
   * `picks` is what the teacher chose by hand: { [post.row]: studentId | 'none' }.
   * A student who is a candidate on a post still waiting for a pick is left out of `noPosts`
   * (D12). `unmatchedLine` is the warning shown above "students with no posts" (D32).
   */
  function summarise(results, students, picks) {
    picks = picks || {};
    var lists = { matched: [], needsLook: [], unmatched: [], accounts: [], noPosts: [], unmatchedLine: '' };
    var accountGroups = new Map();
    var hasPost = new Set(), waiting = new Set();

    results.forEach(function (result) {
      var pick = picks[result.post.row];
      if (typeof pick === 'number' && students[pick]) {
        lists.matched.push({ post: result.post, studentId: pick, label: '', pickedByTeacher: true });
        hasPost.add(pick);
      } else if (pick === 'none' || result.status === 'unmatched') {
        lists.unmatched.push({ post: result.post });
      } else if (result.status === 'matched') {
        lists.matched.push({ post: result.post, studentId: result.studentId, label: result.label, via: result.via, pickedByTeacher: false });
        hasPost.add(result.studentId);
      } else if (result.status === 'needs-look') {
        lists.needsLook.push({ post: result.post, candidateIds: result.candidateIds, reason: result.reason });
        result.candidateIds.forEach(function (id) { waiting.add(id); });
      } else {
        if (!accountGroups.has(result.account)) accountGroups.set(result.account, []);
        accountGroups.get(result.account).push(result.post);
      }
    });

    accountGroups.forEach(function (posts, account) { lists.accounts.push({ account: account, posts: posts }); });
    lists.noPosts = students.filter(function (student) { return !hasPost.has(student.id) && !waiting.has(student.id); });
    var n = lists.unmatched.length;
    if (n > 0) {
      lists.unmatchedLine = n + (n === 1 ? ' post' : ' posts') +
        ' could not be matched; some of these students may have written them.';
    }
    return lists;
  }

  /*
   * The class list was edited: carry the teacher's picks over to the new list. A pick follows its
   * student by name (case, accents and word order ignored); of several students with the same
   * name, the first keeps the first one's picks, and so on. Returns the picks that still have a
   * student, and the names of the students whose picks have nowhere to go.
   */
  function remapPicks(picks, oldStudents, newStudents) {
    var keyOf = function (student) { return normaliseName(student.name).split(' ').sort().join(' '); };
    var newIdsByKey = new Map();
    newStudents.forEach(function (student) {
      var key = keyOf(student);
      if (!newIdsByKey.has(key)) newIdsByKey.set(key, []);
      newIdsByKey.get(key).push(student.id);
    });
    var seen = new Map(), newIdOf = new Map(); // old id -> new id
    oldStudents.forEach(function (student) {
      var key = keyOf(student);
      var nth = seen.get(key) || 0;
      seen.set(key, nth + 1);
      var ids = newIdsByKey.get(key) || [];
      if (nth < ids.length) newIdOf.set(student.id, ids[nth]);
    });
    var kept = {}, lost = [];
    Object.keys(picks).forEach(function (row) {
      var pick = picks[row];
      if (pick === 'none') kept[row] = pick;
      else if (newIdOf.has(pick)) kept[row] = newIdOf.get(pick);
      else if (oldStudents[pick] && lost.indexOf(oldStudents[pick].name) === -1) lost.push(oldStudents[pick].name);
    });
    return { picks: kept, lost: lost };
  }

  return {
    remapPicks: remapPicks,
    normaliseName: normaliseName,
    parseClassList: parseClassList,
    createMatcher: createMatcher,
    matchPosts: matchPosts,
    summarise: summarise
  };
});
