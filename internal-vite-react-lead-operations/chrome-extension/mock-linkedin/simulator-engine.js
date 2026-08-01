const FIXTURE_POST_TOPICS = [
  ({ name, company }) =>
    `${name} shared how ${company} is turning customer feedback into smaller, faster product experiments while keeping the team focused on measurable outcomes.`,
  ({ name, company }) =>
    `${name} reflected on a recent ${company} project and explained why clear ownership, short feedback loops, and honest retrospectives mattered more than adding process.`,
  ({ name, company }) =>
    `${name} celebrated a team milestone at ${company}, highlighting the quiet collaboration and consistent execution that made the result possible.`,
  ({ name, company }) =>
    `${name} outlined three lessons from growing ${company}: stay close to customers, document decisions, and make the next useful step obvious to everyone.`,
  ({ name, company }) =>
    `${name} described how ${company} approaches hiring by looking for curiosity, sound judgment, and people who make the colleagues around them more effective.`,
];

export function assertSafeSimulatorLocation(locationLike) {
  const protocol = String(locationLike?.protocol ?? "");
  const pathname = String(locationLike?.pathname ?? "");
  if (
    protocol !== "chrome-extension:" ||
    !pathname.endsWith("/mock-linkedin/simulator.html")
  ) {
    throw new Error(
      "Simulation is restricted to the extension-owned mock LinkedIn page.",
    );
  }
}

export function createLeadFixture(lead, requestedPostCount = 3) {
  const name = cleanText(lead?.fullName) || "Sample Lead";
  const company = cleanText(lead?.companyName) || "Example Company";
  const title = cleanText(lead?.currentTitle) || "Business Leader";
  const postCount = clampInteger(requestedPostCount, 1, 10);
  const posts = Array.from({ length: postCount }, (_, index) => ({
    id: `fixture-post-${index + 1}`,
    text: FIXTURE_POST_TOPICS[index % FIXTURE_POST_TOPICS.length]({
      name,
      company,
    }),
  }));
  return {
    id: String(lead?.id ?? "fixture-lead"),
    name,
    company,
    title,
    email: fixtureEmail(name),
    posts,
  };
}

export function fixtureEmail(name) {
  const localPart = String(name)
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9\s.-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s.]+/g, ".")
    .replace(/^\.+|\.+$/g, "") || "sample.lead";
  return `${localPart}@simulated.example`;
}

export function scaledSimulationDelay(minutes) {
  const value = Math.max(0, Number(minutes) || 0);
  return Math.min(1_500, Math.max(180, Math.round(value * 5)));
}

export async function runLeadSimulation({
  lead,
  settings,
  api,
  view,
  sleep = defaultSleep,
}) {
  validateAdapter(api, ["draftComment", "transition"]);
  validateAdapter(view, [
    "visitProfile",
    "focusPost",
    "reactToPost",
    "commentOnPost",
    "recordStatus",
    "sendInvitation",
    "acceptInvitation",
    "openContactInfo",
    "readContactEmail",
  ]);

  const fixture = createLeadFixture(lead, settings?.postEngagements ?? 3);
  await view.visitProfile(fixture);

  for (let index = 0; index < fixture.posts.length; index += 1) {
    const post = fixture.posts[index];
    await view.focusPost(post, index, fixture.posts.length);
    const result = await api.draftComment(post.text);
    const draft = cleanText(result?.draft);
    if (!draft) throw new Error("GPT-5.6 Luna returned an empty fixture comment.");
    await view.reactToPost(post);
    await view.commentOnPost(post, draft);
    if (index < fixture.posts.length - 1) {
      await sleep(
        scaledSimulationDelay(settings?.engagementIntervalMinutes ?? 1),
      );
    }
  }

  await api.transition("engaged", { postCount: fixture.posts.length });
  await view.recordStatus("engaged");
  await sleep(scaledSimulationDelay(settings?.connectionDelayMinutes ?? 0));

  const note = settings?.includeNote
    ? `Hi ${fixture.name.split(/\s+/)[0]}, I enjoyed your perspective and would be glad to connect.`
    : null;
  await view.sendInvitation(note);
  await api.transition("connection_requested", { note });
  await view.recordStatus("connection_requested");

  await sleep(650);
  await view.acceptInvitation();
  await api.transition("accepted", {});
  await view.recordStatus("accepted");

  await sleep(350);
  await view.openContactInfo();
  const email = cleanText(await view.readContactEmail());
  if (!email || !email.includes("@")) {
    throw new Error("The fixture contact overlay did not contain an email.");
  }
  await api.transition("email_collected", { email });
  await view.recordStatus("email_collected");

  return {
    leadId: fixture.id,
    postsEngaged: fixture.posts.length,
    invitationNote: note,
    email,
  };
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clampInteger(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Math.trunc(Number(value) || 0)));
}

function validateAdapter(value, methods) {
  for (const method of methods) {
    if (typeof value?.[method] !== "function") {
      throw new Error(`Simulation adapter is missing ${method}().`);
    }
  }
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
