const GREETINGS = [
  "Welcome back.",
  "Good to see you.",
  "Ready when you are.",
] as const;

export async function getGreeting(): Promise<string> {
  const index = new Date().getSeconds() % GREETINGS.length;

  return GREETINGS[index];
}
