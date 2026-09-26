const $ = (selector) => document.querySelector(selector);
const state = { report: null, students: [], historical: false };

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  const data = await response.json();
  if (response.status === 401) {
    location.assign('/login');
    throw new Error('Please sign in again.');
  }
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function notify(message, isError = false) {
  const banner = $('#notice');
  banner.textContent = message;
  banner.className = `notice show${isError ? ' error' : ''}`;
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => { banner.className = 'notice'; }, 5000);
}

function tomorrowISO() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const date = new Date(Date.UTC(
    Number(parts.find((part) => part.type === 'year').value),
    Number(parts.find((part) => part.type === 'month').value) - 1,
    Number(parts.find((part) => part.type === 'day').value) + 1,
  ));
  return date.toISOString().slice(0, 10);
}

function setReportLoading(message = 'Loading report…') {
  $('#report-content').replaceChildren(node('p', message, 'empty'));
  $('#report-date').textContent = message;
}

async function loadDashboard() {
  state.historical = false;
  setReportLoading();
  try {
    const data = await api('/api/dashboard');
    renderReport(data.report, data.heading);
    renderCollegeLeaveNotice(data.collegeLeaves || []);
    await loadArchive();
  } catch (error) {
    setReportLoading(error.message.includes('eligible students')
      ? 'Add at least 15 active students to the real roster, then generate the report.'
      : error.message);
    notify(error.message, true);
  }
}

function renderCollegeLeaveNotice(collegeLeaves) {
  const notice = $('#college-leave-notice');
  notice.replaceChildren();
  notice.classList.toggle('hidden', collegeLeaves.length === 0);
  $('#roster-heading').textContent = collegeLeaves.length ? 'Next valid roster' : "Tomorrow's roster";
  $('#tomorrow-label').textContent = collegeLeaves.length
    ? `College Leave · ${collegeLeaves[0].date}`
    : state.report?.date || 'Loading…';
  if (!collegeLeaves.length) return;
  notice.append(node('h2', 'College Leave'));
  for (const leave of collegeLeaves) {
    const description = leave.reason ? `${leave.date} · ${leave.reason}` : leave.date;
    notice.append(node('p', description));
  }
  notice.append(node('p', `No roster is shown for the college-leave date${collegeLeaves.length > 1 ? 's' : ''}. The next valid schedule is displayed below.`));
}

function renderReport(report, heading) {
  state.report = report;
  $('#extra-assignment-form').hidden = state.historical;
  $('#report-kicker').textContent = heading || 'DAILY REPORT';
  $('#report-date').textContent = report.date;
  $('#report-theme').textContent = report.theme ? `Theme · ${report.theme}` : 'Theme not set';
  $('#status-badge').textContent = report.status;
  $('#tomorrow-label').textContent = report.date;
  $('#finalize').disabled = !report.sessionId || !['Generated', 'Modified'].includes(report.status);
  $('#complete').disabled = !report.sessionId || report.status !== 'Finalized';
  const content = $('#report-content');
  content.replaceChildren();
  for (const section of report.sections || []) {
    const box = node('section', undefined, 'role-group');
    box.append(node('h3', section.label));
    const list = node('ol');
    for (const name of section.assignments) {
      const item = node('li');
      const matching = report.assignments.find((assignment) =>
        assignment.student === name && assignment.role === section.label.replace(/s$/, '') && assignment.isReplacement
      );
      item.append(document.createTextNode(`${name}${matching ? '*' : ''}`));
      list.append(item);
    }
    box.append(list);
    content.append(box);
  }
  const other = node('section', undefined, 'other-roles');
  other.append(node('h3', 'Other roles', 'other-heading'));
  for (const item of report.otherRoles || []) {
    const role = node('div', undefined, 'other-role');
    role.append(node('span', item.role), node('strong', item.student));
    other.append(role);
  }
  content.append(other);
  const exceptions = node('div', undefined, 'exception-list');
  addExceptions(exceptions, 'ON DUTY', report.onDuty || [], false);
  addExceptions(exceptions, 'LEAVE', report.leave || [], true);
  content.append(exceptions);
}

function addExceptions(parent, title, items, leave) {
  const box = node('section', undefined, `exception-box${leave ? ' leave-box' : ''}`);
  box.append(node('h3', title));
  if (!items.length) box.append(node('p', 'None'));
  for (const item of items) {
    const description = item.replacement === '—' ? item.student : `${item.student} · ${item.originalRole} → ${item.replacement}`;
    box.append(node('p', description));
  }
  parent.append(box);
}

async function loadArchive() {
  try {
    const { dates } = await api('/api/reports');
    const select = $('#history-select');
    const current = select.value;
    select.replaceChildren(new Option('Select a date…', ''));
    for (const entry of dates) {
      const value = String(entry.date).slice(0, 10);
      select.add(new Option(new Date(`${value}T12:00:00`).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
      }), value));
    }
    if (current) select.value = current;
  } catch (error) { notify(error.message, true); }
}

async function loadStudents() {
  const { students } = await api('/api/students');
  state.students = students;
  $('#roster-count').textContent = `${students.filter((student) => student.status === 'Active').length} active`;
  const tbody = $('#roster-body');
  tbody.replaceChildren();
  $('#empty-roster').classList.toggle('hidden', students.length > 0);
  for (const student of students) {
    const row = document.createElement('tr');
    row.append(node('td', String(student.rotationOrder + 1).padStart(2, '0')));
    const name = node('td', `${student.name} · ${student.rollNo}`, 'student-name');
    row.append(name, node('td', student.dept || '—'), node('td', student.status));
    const actionCell = node('td');
    const action = node('button', student.status === 'Active' ? 'Deactivate' : 'Activate', 'mini-button');
    action.type = 'button';
    action.addEventListener('click', async () => {
      try {
        await api(`/api/students/${student.id}`, { method: 'PATCH', body: JSON.stringify({ status: student.status === 'Active' ? 'Inactive' : 'Active' }) });
        await loadStudents();
        notify('Roster updated.');
      } catch (error) { notify(error.message, true); }
    });
    actionCell.append(action);
    row.append(actionCell);
    tbody.append(row);
  }
  const active = students.filter((student) => student.status === 'Active');
  const availability = $('#availability-student');
  const override = $('#override-student');
  const extra = $('#extra-student');
  availability.replaceChildren();
  override.replaceChildren();
  extra.replaceChildren();
  availability.add(new Option('Choose a student…', ''));
  override.add(new Option('Choose a student…', ''));
  extra.add(new Option('Choose a student…', ''));
  for (const student of active) {
    availability.add(new Option(`${student.name} · ${student.rollNo}`, student.id));
    override.add(new Option(`${student.name} · ${student.rollNo}`, student.id));
    extra.add(new Option(`${student.name} · ${student.rollNo}`, student.id));
  }
}

async function loadCollegeLeaves() {
  const { collegeLeaves } = await api('/api/college-leaves');
  const list = $('#college-leave-list');
  list.replaceChildren();
  if (!collegeLeaves.length) {
    list.append(node('li', 'No college-leave dates marked.', 'muted'));
    return;
  }
  for (const leave of collegeLeaves) {
    const item = node('li');
    const description = node('span', leave.reason ? `${leave.date} · ${leave.reason}` : leave.date);
    const remove = node('button', 'Remove / Cancel', 'mini-button');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      try {
        const result = await api(`/api/college-leaves/${leave.date}`, { method: 'DELETE' });
        renderReport(result.dashboard.report, result.dashboard.heading);
        renderCollegeLeaveNotice(result.dashboard.collegeLeaves || []);
        await loadCollegeLeaves();
        await loadArchive();
        notify('College Leave removed.');
      } catch (error) { notify(error.message, true); }
    });
    item.append(description, remove);
    list.append(item);
  }
}

function setupOverride() {
  const roles = [...new Set((state.report?.assignments || []).map((assignment) => assignment.role))];
  const roleSelect = $('#override-role');
  roleSelect.replaceChildren();
  for (const role of roles) roleSelect.add(new Option(role, role));
  const updateSeats = () => {
    const matching = (state.report?.assignments || []).filter((assignment) => assignment.role === roleSelect.value);
    $('#override-seat').replaceChildren(...matching.map((assignment, index) => new Option(
      `Seat ${index + 1} · ${assignment.student}`, String(index)
    )));
  };
  roleSelect.addEventListener('change', updateSeats);
  updateSeats();
}

$('#logout').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' });
  location.assign('/login');
});

$('#generate').addEventListener('click', async () => {
  const theme = window.prompt('Optional theme for this meeting:', state.report?.theme || '');
  if (theme === null) return;
  try {
    const data = await api('/api/generate-tomorrow', { method: 'POST', body: JSON.stringify({ theme }) });
    renderReport(data.dashboard.report, data.dashboard.heading);
    renderCollegeLeaveNotice(data.dashboard.collegeLeaves || []);
    setupOverride();
    await loadArchive();
    notify(data.collegeLeave
      ? 'Tomorrow is College Leave; no schedule was generated for that date.'
      : data.alreadyExists ? 'Tomorrow’s report is up to date.' : 'Tomorrow’s report has been generated.');
  } catch (error) { notify(error.message, true); }
});

$('#availability-date').value = tomorrowISO();
$('#college-leave-date').value = tomorrowISO();
$('#college-leave-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const result = await api('/api/college-leaves', { method: 'POST', body: JSON.stringify({
      date: $('#college-leave-date').value,
      reason: $('#college-leave-reason').value,
    }) });
    renderReport(result.dashboard.report, result.dashboard.heading);
    renderCollegeLeaveNotice(result.dashboard.collegeLeaves || []);
    await loadCollegeLeaves();
    await loadArchive();
    event.currentTarget.reset();
    $('#college-leave-date').value = tomorrowISO();
    notify('College Leave marked.');
  } catch (error) { notify(error.message, true); }
});

$('#availability-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const result = await api('/api/availability', { method: 'POST', body: JSON.stringify({
      studentId: $('#availability-student').value,
      type: $('#availability-type').value,
      date: $('#availability-date').value,
    }) });
    if (result.dashboard) renderReport(result.dashboard.report, result.dashboard.heading);
    await loadStudents();
    notify(result.recalculated ? 'Unavailable status saved; an eligible replacement was assigned.' : result.reason || 'Availability saved.');
  } catch (error) { notify(error.message, true); }
});

$('#student-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api('/api/students', { method: 'POST', body: JSON.stringify({
      rollNo: form.get('rollNo'), name: form.get('name'), dept: form.get('dept'),
    }) });
    event.currentTarget.reset();
    await loadStudents();
    notify('Student added to the end of the rotation.');
  } catch (error) { notify(error.message, true); }
});

$('#history-select').addEventListener('change', async (event) => {
  if (!event.target.value) return;
  try {
    const data = await api(`/api/reports/${event.target.value}`);
    state.historical = true;
    renderReport(data.report, data.heading);
    setupOverride();
  } catch (error) { notify(error.message, true); }
});

$('#show-tomorrow').addEventListener('click', loadDashboard);
$('#reset-schedules').addEventListener('click', async (event) => {
  const confirmed = window.confirm(
    'Reset all schedules from the beginning?\n\nThis permanently deletes saved schedules and their history, individual availability, and college-leave dates. Students and app settings will be kept. The next schedule will start from the first student in the rotation.'
  );
  if (!confirmed) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await api('/api/reset-schedules', { method: 'POST' });
    $('#history-select').value = '';
    notify('Schedules and history cleared. The next schedule starts from the beginning of the roster.');
    await Promise.all([loadDashboard(), loadCollegeLeaves()]);
  } catch (error) {
    notify(error.message, true);
  } finally {
    button.disabled = false;
  }
});
$('#finalize').addEventListener('click', async () => {
  try {
    const data = await api(`/api/reports/${state.report.sessionId}/finalize`, { method: 'POST' });
    renderReport(data.dashboard.report, data.dashboard.heading);
    notify('Report finalized.');
  } catch (error) { notify(error.message, true); }
});
$('#complete').addEventListener('click', async () => {
  try {
    const data = await api(`/api/reports/${state.report.sessionId}/complete`, { method: 'POST' });
    renderReport(data.dashboard.report, data.dashboard.heading);
    notify('Meeting marked complete.');
  } catch (error) { notify(error.message, true); }
});
$('#override-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const result = await api('/api/override', { method: 'POST', body: JSON.stringify({
      sessionId: state.report.sessionId,
      role: $('#override-role').value,
      studentId: $('#override-student').value,
      slotIndex: Number($('#override-seat').value),
    }) });
    renderReport(result.dashboard.report, result.dashboard.heading);
    setupOverride();
    notify('Role override applied and recorded.');
  } catch (error) { notify(error.message, true); }
});
$('#extra-assignment-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const result = await api('/api/extra-assignment', { method: 'POST', body: JSON.stringify({
      sessionId: state.report.sessionId,
      role: $('#extra-role').value,
      studentId: $('#extra-student').value,
    }) });
    renderReport(result.dashboard.report, result.dashboard.heading);
    setupOverride();
    event.currentTarget.reset();
    notify('Extra assignment added and recorded for tomorrow’s rotation.');
  } catch (error) { notify(error.message, true); }
});
$('#copy-report').addEventListener('click', async () => {
  if (!state.report?.text) return;
  await navigator.clipboard.writeText(state.report.text);
  notify('Report text copied.');
});

Promise.all([loadStudents(), loadDashboard()])
  .then(setupOverride)
  .catch((error) => notify(error.message, true));
loadCollegeLeaves().catch((error) => notify(error.message, true));
