/*
 * The page: reads the file and the class list, runs the matcher, and draws the lists.
 * All the deciding is done in read-export.js, match.js and result-rows.js; this file only
 * moves things on and off the screen. Student-typed text is always put on the page as text
 * (textContent), never as HTML.
 */
(function () {
  'use strict';
  var W = window.WhoWroteThis;
  var CHUNK = 200; // posts matched per step, so a big board does not freeze the page

  var state = {
    posts: null, // the posts read from the file, or null when there is no usable file
    students: [], // the class list the results on screen were made with
    results: [], // one per post, from the matcher
    picks: {}, // what the teacher chose by hand: post row -> student id or 'none'
    lists: null, // what is on screen; null while matching is running
    run: 0, // goes up with every re-match, so an older one still running can tell it is stale
    waitingClass: null // a class list that would drop picks, waiting for the teacher's yes
  };

  var $ = function (id) { return document.getElementById(id); };
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function button(text, className, onClick) {
    var node = el('button', className, text);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }
  function show(node, visible) { node.hidden = !visible; }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function titleOf(post) { return post.title === '' ? '(no title)' : post.title; }

  // ---------- Step 1: the file ----------

  function takeBytes(bytes, label) {
    var result = W.readExport(bytes);
    show($('file-error'), !result.ok);
    if (!result.ok) {
      $('file-error').textContent = result.message;
      $('file-status').textContent = 'That file could not be used. You can try another one.';
      state.posts = null;
    } else {
      state.posts = result.posts;
      $('file-status').textContent = label + ': ' + plural(result.posts.length, 'post') + ' found.';
    }
    state.picks = {}; // a different board: earlier picks do not apply
    rematch();
  }

  function takeFile(file) {
    if (!file) return;
    $('file-status').textContent = 'Reading ' + file.name + '…';
    var reader = new FileReader();
    reader.onload = function () { takeBytes(new Uint8Array(reader.result), file.name); };
    reader.onerror = function () {
      show($('file-error'), true);
      $('file-error').textContent = 'Your browser could not read that file. Try choosing it again.';
      $('file-status').textContent = 'No file yet.';
      state.posts = null;
      rematch();
    };
    reader.readAsArrayBuffer(file);
  }

  function loadSample() {
    $('class-input').value = W.sampleClassList;
    applyClassList(W.parseClassList(W.sampleClassList), {});
    takeBytes(new TextEncoder().encode(W.samplePostsCsv()), 'Sample board (made-up names)');
  }

  // ---------- Step 2: the class list ----------

  function describeClassList(parsed) {
    var notes = [];
    var d = parsed.dropped;
    if (d.blankLines) notes.push(plural(d.blankLines, 'blank line') + ' skipped');
    if (d.commaLines) notes.push(d.namesFromCommaLines + ' names split from ' + plural(d.commaLines, 'line') + ' that listed several students with commas');
    if (d.headerRows) notes.push('header row skipped');
    if (d.idCells) notes.push(plural(d.idCells, 'ID number') + ' dropped');
    if (d.emailCells) notes.push(d.emailCells + (d.emailCells === 1 ? ' email address' : ' email addresses') + ' dropped');
    var seen = {}, repeats = 0;
    parsed.students.forEach(function (student) {
      var key = W.normaliseName(student.name).split(' ').sort().join(' ');
      if (seen[key] === 1) repeats++;
      seen[key] = (seen[key] || 0) + 1;
    });
    if (repeats) notes.push(plural(repeats, 'name') + ' on the list more than once (kept as separate students)');
    if (parsed.students.length === 0) return 'No students yet.';
    return plural(parsed.students.length, 'student') + (notes.length ? ' (' + notes.join('; ') + ').' : '.');
  }

  function applyClassList(parsed, picks) {
    state.waitingClass = null;
    show($('class-warning'), false);
    state.students = parsed.students;
    state.picks = picks;
    $('class-status').textContent = describeClassList(parsed);
    buildPicker();
  }

  // The class list was edited. Picks follow their student onto the new list. If some picks would
  // have no student left, the new list is not used until the teacher says so.
  function classListEdited() {
    var parsed = W.parseClassList($('class-input').value);
    var carried = W.remapPicks(state.picks, state.students, parsed.students);
    if (carried.lost.length === 0) {
      applyClassList(parsed, carried.picks);
      rematch();
      return;
    }
    state.waitingClass = { parsed: parsed, picks: carried.picks };
    $('class-warning-text').textContent = 'This change takes ' + carried.lost.join(', ') +
      ' off the class list, and you have picked posts for ' + (carried.lost.length === 1 ? 'that student' : 'those students') +
      '. The results below still use the list from before this change.';
    show($('class-warning'), true);
    $('class-status').textContent = 'Not used yet: ' + describeClassList(parsed);
  }

  // ---------- Matching, in chunks ----------

  function rematch() {
    var run = ++state.run; // a newer run cancels an older one still in progress
    state.results = [];
    state.lists = null;
    closePicker();
    // Nothing from the earlier run stays on screen or clickable while this one is going.
    show($('results'), false);
    show($('results-empty'), true);
    if (state.posts === null) { draw(); return; }
    $('results-empty').textContent = 'Matching…';
    var matcher = W.createMatcher(state.students);
    var posts = state.posts, done = 0;
    show($('progress'), posts.length > CHUNK);
    (function step() {
      if (run !== state.run) return;
      for (var end = Math.min(done + CHUNK, posts.length); done < end; done++) {
        state.results.push(matcher.matchPost(posts[done]));
      }
      $('progress-bar').value = posts.length ? done / posts.length : 1;
      $('progress-text').textContent = 'Matching post ' + done + ' of ' + posts.length;
      if (done < posts.length) { setTimeout(step, 0); return; }
      show($('progress'), false);
      draw();
    })();
  }

  // ---------- The one shared picker ----------

  // One drop-down for the whole page, moved to whichever post the teacher is assigning. (One per
  // post would mean thousands of copies of the class list on a big board.)
  var picker = el('span', 'picker');
  var pickerSelect = el('select');
  var pickerRow = null;
  pickerSelect.setAttribute('aria-label', 'Student for this post');
  picker.appendChild(pickerSelect);
  picker.appendChild(button('Assign', 'pick', function () {
    if (pickerRow === null || pickerSelect.value === '') return;
    choose(pickerRow, pickerSelect.value === 'none' ? 'none' : Number(pickerSelect.value));
  }));
  picker.appendChild(button('Cancel', null, closePicker));

  function buildPicker() {
    pickerSelect.textContent = '';
    pickerSelect.appendChild(new Option('Choose a student…', ''));
    state.students.forEach(function (student) { pickerSelect.appendChild(new Option(student.name, String(student.id))); });
    pickerSelect.appendChild(new Option('No student (could not be matched)', 'none'));
  }

  function openPicker(row, place) {
    pickerRow = row;
    pickerSelect.value = '';
    place.appendChild(picker);
    pickerSelect.focus();
  }

  function closePicker() {
    pickerRow = null;
    if (picker.parentNode) picker.parentNode.removeChild(picker);
  }

  function choose(row, value) {
    if (state.lists === null) return; // matching is running; there is nothing on screen to pick from
    if (value === undefined) delete state.picks[row]; else state.picks[row] = value;
    closePicker();
    draw();
    // Keep the keyboard where the work is: the next unclear post, or the summary when none is left.
    var next = document.querySelector('#look-list button.pick');
    (next || $('summary')).focus();
  }

  // ---------- Step 3: the lists ----------

  function postCard(post) {
    var item = el('li');
    item.appendChild(el('div', 'post-title', titleOf(post)));
    item.appendChild(el('div', 'post-meta', 'Post ' + post.number + ' · Padlet author: ' + (post.author || '(none)')));
    if (post.body) item.appendChild(el('div', 'post-meta', post.body.length > 160 ? post.body.slice(0, 160) + '…' : post.body));
    return item;
  }

  function fill(list, items, emptyText) {
    list.textContent = '';
    items.forEach(function (item) { list.appendChild(item); });
    if (items.length === 0) list.appendChild(el('li', 'status', emptyText));
  }

  function draw() {
    var ready = state.posts !== null;
    show($('results'), ready);
    show($('results-empty'), !ready);
    if (!ready) {
      state.lists = null;
      $('results-empty').textContent = 'Add the export and the class list above to see the results here.';
      return;
    }

    var students = state.students;
    var lists = W.summarise(state.results, students, state.picks);
    var nameOf = function (id) { return students[id].name; };
    state.lists = lists;

    $('summary').textContent = W.summaryLine(lists, state.posts.length, students.length);

    $('look-title').textContent = 'Needs a look (' + lists.needsLook.length + ')';
    fill($('look-list'), lists.needsLook.map(function (entry) {
      var card = postCard(entry.post);
      card.appendChild(el('div', 'post-meta', entry.reason));
      var choices = el('div');
      entry.candidateIds.forEach(function (id) {
        choices.appendChild(button(nameOf(id), 'pick', function () { choose(entry.post.row, id); }));
      });
      choices.appendChild(button('None of these', 'pick', function () { choose(entry.post.row, 'none'); }));
      card.appendChild(choices);
      return card;
    }), 'Nothing needs a look.');

    $('matched-title').textContent = 'Who wrote what (' + lists.matched.length + ')';
    var body = $('matched-table').tBodies[0];
    body.textContent = '';
    lists.matched.slice().sort(function (a, b) { return a.studentId - b.studentId; }).forEach(function (entry) {
      var row = body.insertRow();
      row.insertCell().textContent = nameOf(entry.studentId);
      row.insertCell().textContent = titleOf(entry.post);
      var how = W.howMatched(entry);
      row.insertCell().appendChild(el('span', how === 'name found in the title' ? null : 'tag', how));
      var change = row.insertCell();
      if (entry.pickedByTeacher) {
        change.appendChild(button('Undo', null, function () { choose(entry.post.row, undefined); }));
      }
      change.appendChild(button('Change', null, function () { openPicker(entry.post.row, change); }));
    });
    show($('matched-table'), lists.matched.length > 0);
    show($('matched-empty'), lists.matched.length === 0);

    $('unmatched-title').textContent = "Posts we couldn't match (" + lists.unmatched.length + ')';
    fill($('unmatched-list'), lists.unmatched.map(function (entry) {
      var card = postCard(entry.post);
      var actions = el('div');
      if (students.length > 0) {
        actions.appendChild(button('Assign to a student…', null, function () { openPicker(entry.post.row, actions); }));
      }
      if (state.picks[entry.post.row] === 'none') {
        actions.appendChild(button('Undo "none of these"', null, function () { choose(entry.post.row, undefined); }));
      }
      card.appendChild(actions);
      return card;
    }), 'Every post was matched or needs a look.');

    $('accounts-title').textContent = 'Logged-in account, not on the class list (' + lists.accounts.length + ')';
    fill($('accounts-list'), lists.accounts.map(function (group) {
      var item = el('li');
      item.appendChild(el('div', 'post-title', group.account));
      item.appendChild(el('div', 'post-meta', plural(group.posts.length, 'post') + ': ' + group.posts.map(titleOf).join(' · ')));
      return item;
    }), 'None.');

    $('noposts-title').textContent = 'Students with no posts (' + lists.noPosts.length + ')';
    show($('unmatched-line'), lists.unmatchedLine !== '' && students.length > 0);
    $('unmatched-line').textContent = lists.unmatchedLine;
    var waiting = lists.needsLook.length > 0
      ? ' Students who are a possible writer of a post above are not listed here until you pick.' : '';
    fill($('noposts-list'), lists.noPosts.map(function (student) { return el('li', null, student.name); }),
      students.length === 0 ? 'Paste your class list to see who has not posted.' : 'Every student has a post.' + waiting);
  }

  // ---------- Copy and download ----------

  function copyResult() {
    if (state.lists === null) return;
    var text = W.rowsToTsv(W.resultRows(state.lists, state.students));
    var done = function () { $('action-status').textContent = 'Copied. Paste it into a spreadsheet.'; };
    var failed = function () { $('action-status').textContent = 'Your browser did not allow copying. Use Download instead.'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, failed);
    else failed();
  }

  function downloadResult() {
    if (state.lists === null) return;
    // The vendored library writes the CSV, so quotes, commas and line breaks are escaped by it.
    var sheet = XLSX.utils.aoa_to_sheet(W.resultRows(state.lists, state.students));
    var csv = '﻿' + XLSX.utils.sheet_to_csv(sheet);
    var link = el('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = 'who-wrote-this.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
    $('action-status').textContent = 'Downloaded who-wrote-this.csv.';
  }

  // ---------- Wiring ----------

  $('file-input').addEventListener('change', function (event) {
    takeFile(event.target.files[0]);
    event.target.value = ''; // so that choosing the same file again is noticed
  });
  $('sample-button').addEventListener('click', loadSample);
  $('copy-button').addEventListener('click', copyResult);
  $('download-button').addEventListener('click', downloadResult);
  $('class-warning-apply').addEventListener('click', function () {
    if (!state.waitingClass) return;
    applyClassList(state.waitingClass.parsed, state.waitingClass.picks);
    rematch();
  });

  var typing = null;
  $('class-input').addEventListener('input', function () {
    clearTimeout(typing);
    typing = setTimeout(classListEdited, 250);
  });

  var zone = $('drop-zone');
  ['dragenter', 'dragover'].forEach(function (name) {
    zone.addEventListener(name, function (event) { event.preventDefault(); zone.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (name) {
    zone.addEventListener(name, function (event) { event.preventDefault(); zone.classList.remove('over'); });
  });
  zone.addEventListener('drop', function (event) { takeFile(event.dataTransfer.files[0]); });
  // A file dropped outside the box must not make the browser leave the page.
  window.addEventListener('dragover', function (event) { event.preventDefault(); });
  window.addEventListener('drop', function (event) { event.preventDefault(); });

  buildPicker();
  // "?sample" in the address opens the page with the sample data already loaded.
  if (/[?&]sample\b/.test(window.location.search)) loadSample();
  else draw();
})();
