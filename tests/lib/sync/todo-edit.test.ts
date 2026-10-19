import { describe, expect, it, vi } from "vitest";
import { parseTodoEdit, readTodoEdit, todoEditAction } from "../../../agent/lib/sync/todo-edit";

const now = { type: "album" as const, canonical_name: "Jemetta Rose's new albums", creator: "Jemetta Rose" };
const link = "https://earmark-two.vercel.app/tips/150";
const written = `Earmark · Listen: Jemetta Rose's new albums, Jemetta Rose (Oct 16) ${link}`;

describe("parseTodoEdit (our own format, no model)", () => {
  it("reads a new name and creator", () => {
    expect(parseTodoEdit(`Earmark · Listen: Lanquidity, Sun Ra (Oct 16) ${link}`, now)).toEqual({ name: "Lanquidity", creator: "Sun Ra" });
  });

  it("with the link removed, the parentheses removed, or both", () => {
    expect(parseTodoEdit("Earmark · Listen: Lanquidity, Sun Ra (Oct 16)", now)).toEqual({ name: "Lanquidity", creator: "Sun Ra" });
    expect(parseTodoEdit(`Earmark · Listen: Lanquidity, Sun Ra ${link}`, now)).toEqual({ name: "Lanquidity", creator: "Sun Ra" });
    expect(parseTodoEdit("Earmark · Listen: Lanquidity, Sun Ra", now)).toEqual({ name: "Lanquidity", creator: "Sun Ra" });
    expect(parseTodoEdit("Listen: Lanquidity, Sun Ra", now)).toEqual({ name: "Lanquidity", creator: "Sun Ra" }); // prefix gone
  });

  it("keeps a name's own parentheses: only the (who, day) Earmark wrote is dropped", () => {
    expect(parseTodoEdit("Earmark · Listen: Abbey Road (Remastered), The Beatles (Ann, Oct 16)", now))
      .toEqual({ name: "Abbey Road (Remastered)", creator: "The Beatles" });
  });

  it("creator removed clears it; a comma in the old name or creator is kept whole", () => {
    expect(parseTodoEdit(`Earmark · Listen: Lanquidity (Oct 16) ${link}`, now)).toEqual({ name: "Lanquidity", creator: null });
    const csn = { type: "album" as const, canonical_name: "Crosby, Stills & Nash", creator: "Crosby, Stills & Nash" };
    expect(parseTodoEdit("Earmark · Listen: Déjà Vu, Crosby, Stills & Nash (Oct 16)", csn)).toEqual({ name: "Déjà Vu", creator: "Crosby, Stills & Nash" });
    expect(parseTodoEdit("Earmark · Listen: Crosby, Stills & Nash, CSNY (Oct 16)", csn)).toEqual({ name: "Crosby, Stills & Nash", creator: "CSNY" });
    expect(parseTodoEdit("Earmark · Listen: Crosby, Stills & Nash (Oct 16)", csn)).toEqual({ name: "Crosby, Stills & Nash", creator: null });
  });

  it("a verb that changed to one with a single type sets the type", () => {
    expect(parseTodoEdit("Earmark · Read: Lanquidity, Sun Ra (Oct 16)", now)).toEqual({ name: "Lanquidity", creator: "Sun Ra", type: "book" });
    expect(parseTodoEdit("Earmark · visit: Cafe Corazon (Oct 16)", now)).toEqual({ name: "Cafe Corazon", creator: null, type: "place" });
  });

  it("the same verb never changes the type", () => {
    const song = { ...now, type: "song" as const };
    expect(parseTodoEdit("Earmark · Listen: Lanquidity, Sun Ra (Oct 16)", song)).toEqual({ name: "Lanquidity", creator: "Sun Ra" });
  });

  it("is null for what it can't be sure of: a free rewrite, an unknown verb, an empty name, or a verb with several types", () => {
    expect(parseTodoEdit("listen to the sun ra thing Ann mentioned", now)).toBeNull();
    expect(parseTodoEdit("Earmark · Buy: Lanquidity, Sun Ra", now)).toBeNull();
    expect(parseTodoEdit("Earmark · Listen:  (Oct 16)", now)).toBeNull();
    expect(parseTodoEdit("Earmark · Watch: Lanquidity, Sun Ra (Oct 16)", now)).toBeNull(); // film_tv or video?
    const book = { ...now, type: "book" as const };
    expect(parseTodoEdit("Earmark · Listen: Lanquidity, Sun Ra (Oct 16)", book)).toBeNull(); // album, song, artist or podcast?
  });
});

describe("todoEditAction (is the Bee text an owner edit?)", () => {
  const last = { text: written, completed: false };
  const formatted = written;

  it("none: Bee shows what Earmark wrote and the tip still reads that way", () => {
    expect(todoEditAction(last, written, formatted)).toBe("none");
  });

  it("refresh: Bee shows what Earmark wrote but the tip's words changed (a fix on the tip page, the lane's name)", () => {
    expect(todoEditAction(last, written, "Earmark · Listen: Lanquidity, Sun Ra (Oct 16) x")).toBe("refresh");
  });

  it("fix: the text differs from what Earmark wrote and from the tip's formatted text", () => {
    expect(todoEditAction(last, "Earmark · Listen: Lanquidity, Sun Ra", formatted)).toBe("fix");
  });

  it("adopt: Bee already shows the tip's formatted text (a run that crashed before saving)", () => {
    expect(todoEditAction(last, "Earmark · Listen: Lanquidity, Sun Ra (Oct 16) x", "Earmark · Listen: Lanquidity, Sun Ra (Oct 16) x")).toBe("adopt");
  });

  it("none: an edit already read and left alone (seen), or nothing recorded to compare with", () => {
    expect(todoEditAction({ ...last, seen: "buy milk" }, "buy milk", formatted)).toBe("none");
    expect(todoEditAction({ ...last, seen: "buy milk" }, "buy oat milk", formatted)).toBe("fix");
    expect(todoEditAction(null, "buy milk", formatted)).toBe("none");
    expect(todoEditAction({ completed: true }, "buy milk", formatted)).toBe("none");
  });
});

describe("readTodoEdit (deterministic first, then one small model call)", () => {
  const model = (output: unknown) => vi.fn<(opts: { prompt: string }) => Promise<{ output: unknown }>>(async () => ({ output }));

  it("never calls the model when the edit parses", async () => {
    const generate = model(null);
    expect(await readTodoEdit(written, "Earmark · Listen: Lanquidity, Sun Ra", now, generate as never)).toEqual({ name: "Lanquidity", creator: "Sun Ra" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("asks the model with only the two todo texts, and takes its answer when it is a correction", async () => {
    const edited = "sun ra lanquidity not jemetta";
    const generate = model({ correction: true, name: "Lanquidity", creator: "Sun Ra", type: "album" });
    expect(await readTodoEdit(written, edited, now, generate as never)).toEqual({ name: "Lanquidity", creator: "Sun Ra" });
    const { prompt } = generate.mock.calls[0]![0];
    expect(prompt).toContain(JSON.stringify(written));
    expect(prompt).toContain(JSON.stringify(edited));
  });

  it("an empty creator clears it; a type is kept only when its verb differs from the tip's", async () => {
    expect(await readTodoEdit(written, "x", now, model({ correction: true, name: "Kindred", creator: "", type: "book" }) as never))
      .toEqual({ name: "Kindred", creator: null, type: "book" });
    expect(await readTodoEdit(written, "x", now, model({ correction: true, name: "Lanquidity", creator: "Sun Ra", type: "song" }) as never))
      .toEqual({ name: "Lanquidity", creator: "Sun Ra" }); // album → song: same verb, the lane keeps its type
  });

  it("null when the model says it isn't a correction, or gives no name", async () => {
    expect(await readTodoEdit(written, "buy milk", now, model({ correction: false, name: "", creator: "", type: "other" }) as never)).toBeNull();
    expect(await readTodoEdit(written, "x", now, model({ correction: true, name: " ", creator: "", type: "album" }) as never)).toBeNull();
  });
});
