/*
 * A made-up board and class list for the "Try with sample data" button.
 *
 * The board is built as a Posts CSV in the same shape Padlet exports (7 columns, the same
 * header, quoted dates, a byte-order mark) and is read by the same code as a real file.
 * Every name here is invented. It is built into the page, so nothing is fetched.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.WhoWroteThis = Object.assign(root.WhoWroteThis || {}, factory());
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CLASS_LIST = [
    'Aisha Rahman', 'Ben Carter', 'Chloé Dubois', 'Daniel Okafor', 'Елена Петрова', 'فريد حداد',
    'Grace Lee', 'Hiro Tanaka', 'Isabel García', 'Jonas Weber', '林美', 'Noah Wilson',
    'Olivia Brown', 'Olivia Bennett', 'Priya Nair', 'Sam Rivera', 'Tomás Novák', 'Will Turner'
  ].join('\n');

  var TEACHER = 'Ms Morgan (msmorgan)'; // a logged-in account, as Padlet exports it

  // [title, body, author]
  var POSTS = [
    ['Example: how to title your post', 'Put your name first, then the book.', TEACHER],
    ['Aisha Rahman - Wonder', 'Auggie is brave and funny.', 'Brave Otter'],
    ['carter, ben: Holes', 'The ending ties everything together.', 'Gentle Heron'],
    ['Chloe Dubois - Matilda', 'I liked the newt.', 'Curious Lynx'],
    ['Danial Okafor', 'My book was The Boy at the Back of the Class.', 'Daring Falcon'],
    ['Елена Петрова - Гарри Поттер', 'Моя любимая книга.', 'Quiet Badger'],
    ['فريد حداد', 'قرأت كتابا عن الفضاء.', 'Clever Gecko'],
    ['Grace', 'Coraline was creepy in a good way.', 'Happy Walrus'],
    ['林美的读书报告', '我读了《草房子》。', 'Jolly Panda'],
    ['Isabel Garcia - Coraline', 'The other mother scared me.', 'Calm Tortoise'],
    ['Olivia - The Hobbit', 'Bilbo is the best.', 'Swift Hare'],
    ['I will recycle more', 'After reading about the ocean.', 'Kind Fox'],
    ['My favourite book', 'It has dragons in it.', 'Proud Stork'],
    ['Priya Nair and Sam Rivera - our group project', 'We read Skellig together.', 'Witty Koala'],
    ['Tomas Novak', 'The Iron Man, by Ted Hughes.', 'Lively Wren'],
    ['The Giver', 'It made me think about memory.', 'Noah Wilson'],
    ["Hiro Tanaka - Charlotte's Web", 'I cried at the end.', 'Sunny Marmot'],
    ['Aisha Rahman - second post: Skellig', 'I read another one!', 'Brave Otter'],
    ['+1 for Wonder!', 'Everyone should read it.', 'Eager Finch'],
    ['Welcome to the class board', 'Posts are due on Friday.', TEACHER]
  ];

  function csvCell(text) {
    return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  // The sample board as the text of a Padlet Posts CSV.
  function samplePostsCsv() {
    var lines = ['Post number,Subject,Body,Post color,Author,Created At,Updated At'];
    POSTS.forEach(function (post, i) {
      var minute = String(10 + i);
      var when = 'Nov 14, 2026 09:' + minute + 'am';
      lines.push([String(i + 1), post[0], post[1], 'White', post[2], when, when].map(csvCell).join(','));
    });
    return '﻿' + lines.join('\n') + '\n';
  }

  return { sampleClassList: CLASS_LIST, samplePostsCsv: samplePostsCsv };
});
