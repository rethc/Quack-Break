// Fake 'expo-task-manager': records defineTask so tests can run the task body.

/** Task name -> executor. */
export const tasks = new Map();

export function defineTask(name, executor) {
  if (typeof name !== 'string' || !name) throw new Error('defineTask needs a task name');
  if (typeof executor !== 'function') throw new Error('defineTask needs a function');
  tasks.set(name, executor);
}

export function isTaskDefined(name) {
  return tasks.has(name);
}

export async function isTaskRegisteredAsync(name) {
  return tasks.has(name);
}

/** Test helper: run a task the way TaskManager does, with { data, error, executionInfo }. */
export async function __run(name, { data = null, error = null } = {}) {
  const executor = tasks.get(name);
  if (!executor) throw new Error(`Task '${name}' is not defined`);
  return executor({ data, error, executionInfo: { taskName: name, eventId: 'test' } });
}
