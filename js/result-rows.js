/*
 * Turns the teacher's lists into the rows that are copied or downloaded.
 * No page code here, so it can be tested on its own.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.WhoWroteThis = Object.assign(root.WhoWroteThis || {}, factory());
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var HEADER = ['Student', 'Post number', 'Post title', 'Padlet author', 'How it was matched'];
  var ACCOUNT_NOTE = 'Logged-in account, not on the class list';

  // A spreadsheet treats a cell starting with = + - or @ as a formula. Students type the titles,
  // so such a cell gets a leading apostrophe, which makes the spreadsheet show it as plain text.
  // Spaces or a line break in front of the sign do not hide it.
  function safeCell(value) {
    var text = String(value == null ? '' : value);
    return /^[\t\r]|^\s*[=+\-@]/.test(text) ? "'" + text : text;
  }

  // The words shown for how a post was matched: on the page, in the copy and in the download.
  function howMatched(entry) {
    if (entry.pickedByTeacher) return 'picked by you';
    if (entry.via === 'author') return entry.label ? entry.label + ', typed as the Padlet author' : 'name typed as the Padlet author';
    if (entry.via === 'account') return entry.label ? entry.label + ', logged-in account' : 'logged-in account';
    return entry.label || 'name found in the title';
  }

  // The one-line summary above the lists. Its four counts always add up to the number of posts.
  function summaryLine(lists, postCount, studentCount) {
    var s = function (n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); };
    if (postCount === 0) return 'This board has no posts, so there is nothing to match.';
    if (studentCount === 0) return s(postCount, 'post') + ' found. Paste your class list above to match them.';
    var fromAccounts = lists.accounts.reduce(function (sum, group) { return sum + group.posts.length; }, 0);
    return s(postCount, 'post') + ', ' + s(studentCount, 'student') + '. ' + lists.matched.length + ' matched, ' +
      lists.needsLook.length + (lists.needsLook.length === 1 ? ' needs a look, ' : ' need a look, ') +
      lists.unmatched.length + ' could not be matched, ' + fromAccounts +
      ' from a logged-in account not on the class list.';
  }

  /*
   * lists: what summarise() returns. students: the class list.
   * Returns rows of plain text, header first, every cell already made safe.
   */
  function resultRows(lists, students) {
    var name = function (id) { return students[id].name; };
    var rows = [];
    var add = function (student, post, how) {
      rows.push([student, post ? post.number : '', post ? post.title : '', post ? post.author : '', how]);
    };
    lists.matched.forEach(function (m) { add(name(m.studentId), m.post, howMatched(m)); });
    lists.needsLook.forEach(function (n) {
      add('', n.post, 'needs a look: ' + n.candidateIds.map(name).join(' / '));
    });
    lists.unmatched.forEach(function (u) { add('', u.post, 'could not be matched'); });
    lists.accounts.forEach(function (group) {
      group.posts.forEach(function (post) { add('', post, ACCOUNT_NOTE); });
    });
    lists.noPosts.forEach(function (student) { add(student.name, null, 'no posts'); });
    return [HEADER].concat(rows).map(function (row) { return row.map(safeCell); });
  }

  // Rows -> text to paste into a spreadsheet: tabs between cells, one row per line.
  function rowsToTsv(rows) {
    return rows.map(function (row) {
      return row.map(function (cell) {
        var flat = cell.replace(/[\t\r\n]+/g, ' ');
        // A pasted cell that starts with a quote mark is read as "quoted" and would run on into
        // the next cells, so it is wrapped in quotes itself, with its own quotes doubled.
        return flat.charAt(0) === '"' ? '"' + flat.replace(/"/g, '""') + '"' : flat;
      }).join('\t');
    }).join('\n');
  }

  return { resultRows: resultRows, rowsToTsv: rowsToTsv, safeCell: safeCell, howMatched: howMatched, summaryLine: summaryLine };
});
