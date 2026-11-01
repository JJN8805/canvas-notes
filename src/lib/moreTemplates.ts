import type { Arrow } from '../types';
import { arrow, builder, type Built } from './templateKit';

/** Ids of the templates added after the first six. Like the first six, every device builds them identically. */
export const MORE_IDS = {
  formBuilder: 'tpl-form-builder',
  registration: 'tpl-registration',
  survey: 'tpl-survey',
  mindmap: 'tpl-mindmap',
  kanban: 'tpl-kanban',
  swot: 'tpl-swot',
  priority: 'tpl-priority',
  cornell: 'tpl-cornell',
  flowchart: 'tpl-flowchart',
  habits: 'tpl-habits',
  budget: 'tpl-budget',
  study: 'tpl-study',
  retro: 'tpl-retro',
  trip: 'tpl-trip',
  decision: 'tpl-decision',
} as const;

type Kit = ReturnType<typeof builder>;

/**
 * Form fields, drawn with ordinary boxes so forms need no special block type: a bold label above an input
 * (a one-cell table is the input box, a checklist gives tick boxes). Returns the y where the next field starts.
 */
export type FieldKind = 'short' | 'long' | 'choice' | 'dropdown' | 'date' | 'rating';
export function field(b: Kit, x: number, y: number, w: number, label: string, kind: FieldKind, frameId?: string, options: string[] = []): number {
  b.text(x, y, w, `<p><strong>${label}</strong></p>`, frameId);
  const iy = y + 40;
  // An input is a text box with its background filled in, so it reads as a white box to type into.
  const box = (h: number, html = '<p></p>') => b.add({ type: 'text', x, y: iy, w, h, html, fill: true, frameId });
  switch (kind) {
    case 'short':
      box(44);
      return y + 100;
    case 'long':
      box(120);
      return y + 176;
    case 'dropdown':
      box(44, '<p>Choose one  ▾</p>');
      return y + 100;
    case 'date':
      box(44, '<p>DD / MM / YYYY</p>');
      return y + 100;
    case 'rating':
      b.text(x, iy, w, '<p>☆  ☆  ☆  ☆  ☆</p>', frameId);
      return y + 90;
    case 'choice': {
      const items = options.length ? options : ['Option 1', 'Option 2', 'Option 3'];
      b.list(x, iy, w, items, frameId);
      return y + 40 + 36 * items.length + 28;
    }
  }
}

/** Sets a frame's height so it ends a little below `bottom` (the y where its last box ends). */
const fit = (b: Kit, frameId: string, bottom: number) => {
  const f = b.blocks.find((x) => x.id === frameId);
  if (f) f.h = Math.max(120, bottom - f.y + 24);
};

const formBuilder = (): Built => {
  const b = builder(MORE_IDS.formBuilder);
  b.text(136, 48, 760, '<h1>Form builder</h1><p>Copy a field from the palette (select it and press Ctrl+D), drag the copy into your form, then type over its label. Arrows show how the form flows.</p>');
  const palette = b.frame(136, 208, 360, 600, 'Field palette', 'slate');
  let y = 256;
  y = field(b, 152, y, 328, 'Short answer', 'short', palette);
  y = field(b, 152, y, 328, 'Paragraph', 'long', palette);
  y = field(b, 152, y, 328, 'Multiple choice', 'choice', palette);
  y = field(b, 152, y, 328, 'Dropdown', 'dropdown', palette);
  y = field(b, 152, y, 328, 'Date', 'date', palette);
  y = field(b, 152, y, 328, 'Rating', 'rating', palette);
  fit(b, palette, y - 16);

  const form = b.frame(560, 208, 520, 600, 'Your form', 'ultra');
  const title = b.text(576, 256, 488, '<h2>Form title</h2><p>A line telling people what this form is for.</p>', form);
  let fy = field(b, 576, 360, 488, 'Your name', 'short', form);
  fy = field(b, 576, fy, 488, 'How can we help?', 'dropdown', form);
  fy = field(b, 576, fy, 488, 'Tell us more', 'long', form);
  const submit = b.sticky(576, fy + 8, 'green', '<p><strong>Submit</strong></p><p>What happens when someone sends the form?</p>', form);
  fit(b, form, fy + 8 + 200);

  const logic = b.frame(1144, 208, 360, 500, 'Form logic', 'ochre');
  const rule = b.sticky(1160, 256, 'yellow', '<p>If “How can we help?” is answered, show the paragraph.</p>', logic);
  const after = b.sticky(1160, 480, 'blue', '<p>After submit: thank-you message, then who gets the answers?</p>', logic);
  fit(b, logic, 480 + 200);
  return {
    title: 'Form builder',
    blocks: b.blocks,
    arrows: [
      arrow(`${MORE_IDS.formBuilder}-a2`, title, rule, 'logic'),
      arrow(`${MORE_IDS.formBuilder}-a3`, submit, after),
    ],
  };
};

const registration = (): Built => {
  const b = builder(MORE_IDS.registration);
  b.text(136, 48, 760, '<h1>Registration form</h1><p>Fill in the boxes below. Fields marked * are required.</p>');
  const you = b.frame(136, 176, 560, 400, 'Your details', 'ultra');
  let y = 224;
  y = field(b, 152, y, 528, 'Full name *', 'short', you);
  y = field(b, 152, y, 528, 'Email *', 'short', you);
  y = field(b, 152, y, 528, 'Phone', 'short', you);
  y = field(b, 152, y, 528, 'Date of birth', 'date', you);
  fit(b, you, y - 16);
  const pref = b.frame(728, 176, 560, 400, 'Preferences', 'teal');
  let y2 = 224;
  y2 = field(b, 744, y2, 528, 'Ticket type *', 'dropdown', pref);
  y2 = field(b, 744, y2, 528, 'Dietary needs', 'choice', pref, ['Vegetarian', 'Vegan', 'Gluten free', 'None']);
  y2 = field(b, 744, y2, 528, 'Anything else we should know?', 'long', pref);
  fit(b, pref, y2 - 16);
  const bottom = Math.max(y, y2) + 24;
  b.sticky(136, bottom, 'green', '<p><strong>Declaration</strong></p><p>I confirm the details above are correct.</p>');
  b.text(376, bottom + 16, 320, '<p>Signature: ______________________</p><p>Date: ____ / ____ / ________</p>');
  return { title: 'Registration form', blocks: b.blocks, arrows: [] };
};

const survey = (): Built => {
  const b = builder(MORE_IDS.survey);
  b.text(136, 48, 760, '<h1>Feedback survey</h1><p>Thanks for taking two minutes. Your answers help us improve.</p>');
  const about = b.frame(136, 176, 480, 300, 'About you', 'slate');
  let y = 224;
  y = field(b, 152, y, 448, 'Name (optional)', 'short', about);
  y = field(b, 152, y, 448, 'Date', 'date', about);
  fit(b, about, y - 16);
  const aboutBox = b.blocks.find((x) => x.id === about)!;
  const aboutBottom = aboutBox.y + aboutBox.h;
  const open = b.frame(136, aboutBottom + 32, 480, 400, 'In your words', 'plum');
  let oy = aboutBottom + 32 + 48;
  oy = field(b, 152, oy, 448, 'What did you like most?', 'long', open);
  oy = field(b, 152, oy, 448, 'What should we change?', 'long', open);
  fit(b, open, oy - 16);
  const rate = b.frame(648, 176, 480, 400, 'How did we do?', 'ochre');
  let ry = 224;
  ry = field(b, 664, ry, 448, 'Overall experience', 'rating', rate);
  ry = field(b, 664, ry, 448, 'Ease of use', 'rating', rate);
  ry = field(b, 664, ry, 448, 'Would you recommend us?', 'choice', rate, ['Yes', 'Maybe', 'No']);
  fit(b, rate, ry - 16);
  b.sticky(648, 176 + b.blocks.find((x) => x.id === rate)!.h + 32, 'green', '<p><strong>Thank you!</strong></p><p>Hand this page back or send it by email.</p>');
  return { title: 'Feedback survey', blocks: b.blocks, arrows: [] };
};

/** An "infinite canvas" starter: ideas spread far in every direction. The page grows wherever you place things. */
const mindmap = (): Built => {
  const b = builder(MORE_IDS.mindmap);
  b.text(136, 48, 760, '<h1>Mind map</h1><p>The page has no edge: keep adding branches in any direction and it grows with you. Drag from a box’s dots to connect ideas.</p>');
  const hub = b.sticky(1040, 640, 'yellow', '<p><strong>Central idea</strong></p>');
  const spec: [number, number, 'blue' | 'green' | 'pink' | 'orange' | 'purple' | 'red', string, string][] = [
    [1040, 240, 'blue', 'Branch: who?', 'People and roles'],
    [1640, 360, 'green', 'Branch: what?', 'Key things to cover'],
    [1760, 880, 'pink', 'Branch: why?', 'Reasons and goals'],
    [1040, 1080, 'orange', 'Branch: how?', 'Steps and methods'],
    [360, 880, 'purple', 'Branch: when?', 'Dates and deadlines'],
    [440, 360, 'red', 'Branch: risks', 'What could go wrong'],
  ];
  const arrows: Arrow[] = [];
  spec.forEach(([x, y, tint, head, sub], i) => {
    const branch = b.sticky(x, y, tint, `<p><strong>${head}</strong></p>`);
    arrows.push(arrow(`${MORE_IDS.mindmap}-b${i}`, hub, branch));
    const dx = x > 1040 ? 260 : -260;
    const leaf = b.text(x + dx, y + 70, 220, `<p>${sub}</p>`);
    arrows.push(arrow(`${MORE_IDS.mindmap}-l${i}`, branch, leaf));
  });
  return { title: 'Mind map', blocks: b.blocks, arrows };
};

const kanban = (): Built => {
  const b = builder(MORE_IDS.kanban);
  b.text(136, 48, 760, '<h1>Kanban board</h1><p>One sticky per task. Drag a sticky from column to column as work moves along.</p>');
  const cols: [string, string, 'slate' | 'ochre' | 'plum' | 'moss'][] = [
    ['To do', 'slate', 'slate'],
    ['Doing', 'ochre', 'ochre'],
    ['Review', 'plum', 'plum'],
    ['Done', 'moss', 'moss'],
  ];
  cols.forEach(([title, color], i) => {
    const x = 136 + i * 320;
    const f = b.frame(x, 176, 296, 600, title, color);
    if (i === 0) {
      b.sticky(x + 16, 224, 'yellow', '<p>Task one</p>', f);
      b.sticky(x + 16, 440, 'yellow', '<p>Task two</p>', f);
    }
    if (i === 1) b.sticky(x + 16, 224, 'orange', '<p>In progress</p>', f);
    if (i === 3) b.sticky(x + 16, 224, 'green', '<p>Finished</p>', f);
  });
  return { title: 'Kanban board', blocks: b.blocks, arrows: [] };
};

const swot = (): Built => {
  const b = builder(MORE_IDS.swot);
  b.text(136, 48, 760, '<h1>SWOT analysis</h1><p>Subject: …</p>');
  const quad: [number, number, string, string, string][] = [
    [136, 176, 'Strengths', 'moss', 'What do we do well?'],
    [648, 176, 'Weaknesses', 'brick', 'Where do we fall short?'],
    [136, 440, 'Opportunities', 'ultra', 'What could we take advantage of?'],
    [648, 440, 'Threats', 'ochre', 'What could hurt us?'],
  ];
  quad.forEach(([x, y, title, color, hint]) => {
    const f = b.frame(x, y, 488, 232, title, color);
    b.list(x + 16, y + 48, 456, [hint, '', ''], f);
  });
  return { title: 'SWOT analysis', blocks: b.blocks, arrows: [] };
};

const priority = (): Built => {
  const b = builder(MORE_IDS.priority);
  b.text(136, 48, 760, '<h1>Priority matrix</h1><p>Sort everything on your plate by urgency and importance.</p>');
  b.text(280, 144, 400, '<p><strong>Urgent</strong></p>');
  b.text(792, 144, 400, '<p><strong>Not urgent</strong></p>');
  const quad: [number, number, string, string, string][] = [
    [136, 184, 'Do first', 'brick', 'Important and urgent'],
    [648, 184, 'Schedule', 'ultra', 'Important, not urgent'],
    [136, 448, 'Delegate', 'ochre', 'Urgent, not important'],
    [648, 448, 'Drop', 'slate', 'Neither'],
  ];
  quad.forEach(([x, y, title, color, hint]) => {
    const f = b.frame(x, y, 488, 232, title, color);
    b.list(x + 16, y + 48, 456, [hint, '', ''], f);
  });
  return { title: 'Priority matrix', blocks: b.blocks, arrows: [] };
};

const cornell = (): Built => {
  const b = builder(MORE_IDS.cornell);
  b.text(136, 48, 760, '<h1>Cornell notes</h1><p>Topic · Date · Source</p>');
  const cues = b.frame(136, 176, 260, 640, 'Cues and questions', 'ochre');
  b.text(152, 224, 228, '<p>Keywords and questions to quiz yourself with…</p>', cues);
  const notes = b.frame(428, 176, 620, 640, 'Notes', 'ultra');
  b.text(444, 224, 588, '<p>Write the lecture or reading notes here…</p>', notes);
  const sum = b.frame(136, 848, 912, 200, 'Summary', 'moss');
  b.text(152, 896, 880, '<p>In two or three sentences, what was this about?</p>', sum);
  return { title: 'Cornell notes', blocks: b.blocks, arrows: [] };
};

const flowchart = (): Built => {
  const b = builder(MORE_IDS.flowchart);
  b.text(136, 48, 760, '<h1>Flowchart</h1><p>Start at the top and follow the arrows. Click an arrow to label it or change its style.</p>');
  const start = b.sticky(520, 176, 'green', '<p><strong>Start</strong></p>');
  const step = b.sticky(520, 456, 'blue', '<p>Do the first step</p>');
  const decide = b.sticky(520, 736, 'yellow', '<p><strong>Decision:</strong> did it work?</p>');
  const yes = b.sticky(900, 736, 'blue', '<p>Yes: continue</p>');
  // beside the step it loops back to, so that arrow runs straight across
  const no = b.sticky(140, 456, 'orange', '<p>No: fix it and try again</p>');
  const end = b.sticky(900, 1016, 'green', '<p><strong>End</strong></p>');
  return {
    title: 'Flowchart',
    blocks: b.blocks,
    arrows: [
      arrow(`${MORE_IDS.flowchart}-1`, start, step),
      arrow(`${MORE_IDS.flowchart}-2`, step, decide),
      arrow(`${MORE_IDS.flowchart}-3`, decide, yes, 'Yes'),
      arrow(`${MORE_IDS.flowchart}-4`, decide, no, 'No'),
      arrow(`${MORE_IDS.flowchart}-5`, no, step),
      arrow(`${MORE_IDS.flowchart}-6`, yes, end),
    ],
  };
};

const habits = (): Built => {
  const b = builder(MORE_IDS.habits);
  b.text(136, 48, 760, '<h1>Habit tracker</h1><p>Week of … · Type ✓ in a box when you do the habit.</p>');
  const rows = [['Habit', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], ...['Drink water', 'Exercise', 'Read', 'Sleep by 11pm', 'Write'].map((h) => [h, '', '', '', '', '', '', ''])];
  b.table(136, 176, 880, rows);
  b.sticky(136, 450, 'yellow', '<p><strong>Wins this week</strong></p>');
  b.sticky(376, 450, 'blue', '<p><strong>Change next week</strong></p>');
  return { title: 'Habit tracker', blocks: b.blocks, arrows: [] };
};

const budget = (): Built => {
  const b = builder(MORE_IDS.budget);
  b.text(136, 48, 760, '<h1>Budget tracker</h1><p>Month: … · Fill in amounts, then total each table.</p>');
  const income = b.frame(136, 176, 440, 230, 'Income', 'moss');
  b.table(152, 224, 408, [['Source', 'Amount'], ['Salary', ''], ['Other', ''], ['Total', '']], income);
  const spend = b.frame(608, 176, 520, 320, 'Spending', 'brick');
  b.table(624, 224, 488, [['Category', 'Planned', 'Actual'], ['Rent', '', ''], ['Food', '', ''], ['Transport', '', ''], ['Bills', '', ''], ['Fun', '', ''], ['Total', '', '']], spend);
  const sum = b.frame(136, 438, 440, 160, 'Left over', 'ultra');
  b.table(152, 486, 408, [['', 'Amount'], ['Income − spending', '']], sum);
  b.sticky(608, 528, 'yellow', '<p><strong>Savings goal</strong></p><p>How much, and by when?</p>');
  return { title: 'Budget tracker', blocks: b.blocks, arrows: [] };
};

const study = (): Built => {
  const b = builder(MORE_IDS.study);
  b.text(136, 48, 760, '<h1>Study plan</h1><p>Subject · Exam date · Goal</p>');
  const topics = b.frame(136, 176, 340, 260, 'Topics to cover', 'ultra');
  b.list(152, 224, 308, ['Topic one', 'Topic two', 'Topic three', ''], topics);
  const week = b.frame(508, 176, 640, 290, 'This week', 'teal');
  b.table(524, 224, 608, [['Day', 'Topic', 'Time', 'Done'], ['Mon', '', '', ''], ['Tue', '', '', ''], ['Wed', '', '', ''], ['Thu', '', '', ''], ['Fri', '', '', '']], week);
  const cards = b.frame(136, 498, 1012, 250, 'Flashcards', 'ochre');
  b.table(152, 546, 980, [['Question', 'Answer'], ['', ''], ['', ''], ['', '']], cards);
  return { title: 'Study plan', blocks: b.blocks, arrows: [] };
};

const retro = (): Built => {
  const b = builder(MORE_IDS.retro);
  b.text(136, 48, 760, '<h1>Retrospective</h1><p>Sprint or project: … · One sticky per point.</p>');
  const cols: [string, string, 'green' | 'red' | 'blue', string][] = [
    ['Start', 'moss', 'green', 'We should start…'],
    ['Stop', 'brick', 'red', 'We should stop…'],
    ['Continue', 'ultra', 'blue', 'Keep doing…'],
  ];
  cols.forEach(([title, color, tint, hint], i) => {
    const x = 136 + i * 400;
    const f = b.frame(x, 176, 376, 280, title, color);
    b.sticky(x + 16, 224, tint, `<p>${hint}</p>`, f);
  });
  const act = b.frame(136, 488, 1152, 180, 'Actions we agree on', 'ochre');
  b.list(152, 536, 1120, ['Who: what, by when', ''], act);
  return { title: 'Retrospective', blocks: b.blocks, arrows: [] };
};

const trip = (): Built => {
  const b = builder(MORE_IDS.trip);
  b.text(136, 48, 760, '<h1>Trip planner</h1><p>Where · When · Who is going</p>');
  const plan = b.frame(136, 176, 640, 270, 'Itinerary', 'teal');
  b.table(152, 224, 608, [['Day', 'Place', 'Plans', 'Booked'], ['1', '', '', ''], ['2', '', '', ''], ['3', '', '', ''], ['4', '', '', '']], plan);
  const pack = b.frame(808, 176, 340, 270, 'Packing list', 'ochre');
  b.list(824, 224, 308, ['Passport / ID', 'Tickets', 'Chargers', ''], pack);
  const money = b.frame(136, 478, 640, 210, 'Budget', 'moss');
  b.table(152, 526, 608, [['Item', 'Cost'], ['Travel', ''], ['Stay', ''], ['Food', '']], money);
  b.sticky(808, 478, 'yellow', '<p><strong>Must see</strong></p><p>Places and food to try…</p>');
  return { title: 'Trip planner', blocks: b.blocks, arrows: [] };
};

const decision = (): Built => {
  const b = builder(MORE_IDS.decision);
  b.text(136, 48, 760, '<h1>Decision matrix</h1><p>Score each option from 1 to 5 for every criterion, multiply by its weight, then add up each column.</p>');
  b.table(136, 192, 880, [
    ['Criterion', 'Weight', 'Option A', 'Option B', 'Option C'],
    ['Cost', '', '', '', ''],
    ['Quality', '', '', '', ''],
    ['Effort', '', '', '', ''],
    ['Risk', '', '', '', ''],
    ['Total', '', '', '', ''],
  ]);
  b.sticky(136, 470, 'green', '<p><strong>Decision</strong></p><p>Which option, and why?</p>');
  return { title: 'Decision matrix', blocks: b.blocks, arrows: [] };
};

/** The templates added after the first six, in the order they appear. */
export const MORE_BUILDERS: [string, () => Built][] = [
  [MORE_IDS.formBuilder, formBuilder],
  [MORE_IDS.registration, registration],
  [MORE_IDS.survey, survey],
  [MORE_IDS.mindmap, mindmap],
  [MORE_IDS.kanban, kanban],
  [MORE_IDS.swot, swot],
  [MORE_IDS.priority, priority],
  [MORE_IDS.cornell, cornell],
  [MORE_IDS.flowchart, flowchart],
  [MORE_IDS.habits, habits],
  [MORE_IDS.budget, budget],
  [MORE_IDS.study, study],
  [MORE_IDS.retro, retro],
  [MORE_IDS.trip, trip],
  [MORE_IDS.decision, decision],
];
