import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

class Element {
  listeners = new Map<string, ((event: any) => void)[]>();
  attributes = new Map<string, string>();
  value = "";
  textContent = "";
  disabled = false;
  dataset: Record<string, string> = {};
  pointer = -1;
  addEventListener(type: string, listener: (event: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  setPointerCapture(id: number) { this.pointer = id; }
  dispatch(type: string, properties = {}) {
    const event = { currentTarget: this, prevented: false, preventDefault() { this.prevented = true; }, ...properties };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }
}

function controller(configuration?: object, screenAngle = 0) {
  let now = 0;
  const packets: DataView[] = [];
  const messages: any[] = [];
  const vibrations: number[] = [];
  const elements = new Map<string, Element>();
  const get = (id: string) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id)!;
  };
  const buttons = [get("guard"), get("start"), get("recenter")];
  const timers = new Map<number, { callback: () => void; due: number }>();
  let timerId = 0;
  const window = Object.assign(new Element(), {
    setTimeout(callback: () => void, delay: number) {
      const id = ++timerId;
      timers.set(id, { callback, due: now + Math.floor(delay) });
      return id;
    },
    clearTimeout(id: number) { timers.delete(id); }
  });
  const document = Object.assign(new Element(), {
    hidden: false,
    getElementById: get,
    querySelectorAll: (selector: string) => selector === "button" ? buttons : []
  });
  const context: any = {
    window, document, navigator: { vibrate: (duration: number) => vibrations.push(duration) }, TextDecoder,
    screen: { orientation: { angle: screenAngle } }, URLSearchParams,
    performance: { now: () => now },
    location: { search: "?session=test&slot=p1&token=secret" },
    localStorage: { getItem() { return configuration ? JSON.stringify(configuration) : null; }, setItem() {} }
  };
  // Expose the real packet sender inside this isolated fixture, without adding
  // test hooks to the page that players load.
  const source = readFileSync("public/controller.js", "utf8").replace(
    '  playerElement.textContent = slot.toUpperCase() || "--";',
    '  globalThis.fixture = { state, sendMotion, attachSensors, configureChannel };\n  playerElement.textContent = slot.toUpperCase() || "--";'
  );
  vm.runInNewContext(source, context);
  context.fixture.state.channel = { readyState: "open", send: (bytes: ArrayBuffer | string) => { if (typeof bytes !== "string") packets.push(new DataView(bytes)); else messages.push(JSON.parse(bytes)); }, close() {} };
  context.fixture.attachSensors();
  return { get, buttons, document, window, packets, messages, vibrations, state: context.fixture.state,
    connect: () => {
      const channel = Object.assign(new Element(), context.fixture.state.channel);
      context.fixture.configureChannel(channel);
      channel.dispatch("open");
      return channel;
    },
    advanceTimers: (milliseconds: number) => {
      const end = now + milliseconds;
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].due - b[1].due)[0];
        if (!next || next[1].due > end) break;
        now = next[1].due;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = end;
    },
    resumeTimers: () => {
      for (const [id, timer] of [...timers]) {
        if (timer.due > now) continue;
        timers.delete(id);
        timer.callback();
      }
    },
    advance: (milliseconds: number) => { now += milliseconds; },
    send: () => context.fixture.sendMotion() };
}

test("feedback vibrates only for valid commands on the active phone channel", () => {
  const fixture = controller();
  const oldChannel = fixture.connect();
  oldChannel.dispatch("message", { data: new TextEncoder().encode('{"type":"vibrate","durationMs":50}').buffer });
  oldChannel.dispatch("message", { data: '{"type":"vibrate","durationMs":100}' });
  oldChannel.dispatch("message", { data: '{"type":"vibrate","durationMs":2000}' });
  oldChannel.dispatch("message", { data: '{"type":"other","durationMs":50}' });
  assert.deepEqual(fixture.vibrations, [50, 100]);
  fixture.state.channel = { readyState: "open" };
  oldChannel.dispatch("message", { data: '{"type":"vibrate","durationMs":50}' });
  assert.deepEqual(fixture.vibrations, [50, 100]);
});

test("periodic packets stay at 100 Hz despite integer browser timer delays", () => {
  const fixture = controller();
  fixture.connect();
  assert.equal(fixture.packets.length, 1, "Channel opening sends immediately.");
  fixture.advanceTimers(60_000);
  const periodic = fixture.packets.length - 1;
  assert.ok(Math.abs(periodic - 6000) <= 1, `Expected 100 Hz; received ${periodic} packets in one minute.`);
});

test("a stalled or replaced phone channel does not produce catch-up packet bursts", () => {
  const fixture = controller();
  fixture.connect();
  fixture.advance(1000);
  fixture.resumeTimers();
  assert.equal(fixture.packets.length, 2);
  fixture.advanceTimers(100);
  assert.ok(fixture.packets.length <= 12);
  fixture.state.channel = { readyState: "open" };
  const before = fixture.packets.length;
  fixture.advanceTimers(1000);
  assert.equal(fixture.packets.length, before);
});

test("every phone button uses a textless icon with an accessible name", () => {
  const html = readFileSync("public/index.html", "utf8");
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  assert.equal(buttons.length, 3);
  for (const [, attributes, contents] of buttons) {
    assert.match(attributes!, /aria-label="[^"]+"/);
    assert.match(contents!, /<svg /);
    assert.equal(contents!.replace(/<[^>]*>/g, "").trim(), "");
  }
});

test("long press prevents pointer focus, selection and menus, then releases guard on interruption", () => {
  const { get, buttons, window, document } = controller();
  for (const button of buttons) {
    for (const type of ["pointerdown", "contextmenu", "selectstart"])
      assert.equal(button.dispatch(type, { pointerId: 7 }).prevented, true);
  }
  const guard = get("guard");
  for (const release of ["pointerup", "pointercancel", "lostpointercapture"]) {
    guard.dispatch("pointerdown", { pointerId: 7 });
    assert.equal(guard.attributes.get("aria-pressed"), "true");
    assert.equal(guard.pointer, 7);
    guard.dispatch(release);
    assert.equal(guard.attributes.get("aria-pressed"), "false");
  }
  guard.dispatch("pointerdown", { pointerId: 7 });
  window.dispatch("blur");
  assert.equal(guard.attributes.get("aria-pressed"), "false");
  guard.dispatch("pointerdown", { pointerId: 7 });
  document.hidden = true;
  document.dispatch("visibilitychange");
  assert.equal(guard.attributes.get("aria-pressed"), "false");
});

test("phone page omits manual movement settings", () => {
  const html = readFileSync("public/index.html", "utf8");
  assert.doesNotMatch(html, /動きの調整|振って選ぶ|盾で決定|control-hint|axis-panel|axis-map-|axis-[xyz]-value/);
});

test("reset packets distinguish a short release from a half-second hold", () => {
  const { get, packets, advance, send } = controller();
  const reset = get("recenter");
  reset.dispatch("pointerdown", { pointerId: 1 });
  assert.equal(packets.at(-1)!.byteLength, 56);
  assert.equal(packets.at(-1)!.getUint8(1) & 16, 16);
  assert.equal(packets.at(-1)!.getUint16(2, true), 0);
  advance(499);
  reset.dispatch("pointerup");
  assert.equal(packets.at(-1)!.getUint8(1) & 16, 0);
  assert.equal(packets.at(-1)!.getUint16(2, true), 1);
  reset.dispatch("lostpointercapture");
  assert.equal(packets.at(-1)!.getUint16(2, true), 1);
  reset.dispatch("pointerdown", { pointerId: 2 });
  advance(500);
  send();
  assert.equal(packets.at(-1)!.getUint8(1) & 16, 16);
  reset.dispatch("pointerup");
  assert.equal(packets.at(-1)!.getUint8(1) & 16, 0);
  assert.equal(packets.at(-1)!.getUint16(2, true), 1);
});

test("reset cancellation, lost focus and page exit release without a reset command", () => {
  const { get, packets, window, document } = controller();
  const reset = get("recenter");
  for (const release of [() => reset.dispatch("pointercancel"), () => reset.dispatch("lostpointercapture"),
    () => window.dispatch("blur"), () => { document.hidden = true; document.dispatch("visibilitychange"); },
    () => window.dispatch("pagehide")]) {
    reset.dispatch("pointerdown", { pointerId: 1 });
    release();
    assert.equal(reset.attributes.get("aria-pressed"), "false");
    assert.equal(packets.at(-1)!.getUint8(1) & 16, 0);
    assert.equal(packets.at(-1)!.getUint16(2, true), 0);
  }
});

test("stopped motion events invalidate acceleration instead of repeating a thrust impulse", () => {
  const { packets, window, advance, send } = controller();
  send();
  assert.equal(packets.at(-1)!.getUint8(1) & 8, 0);
  window.dispatch("devicemotion", { acceleration: { x: 0, y: 0, z: 5 } });
  send();
  assert.equal(packets.at(-1)!.getUint8(1) & 8, 8);
  advance(99);
  send();
  assert.equal(packets.at(-1)!.getUint8(1) & 8, 8);
  advance(1);
  send();
  assert.equal(packets.at(-1)!.getUint8(1) & 8, 0);
  window.dispatch("devicemotion", { acceleration: { x: 0, y: 0, z: 0 } });
  send();
  assert.equal(packets.at(-1)!.getUint8(1) & 8, 8);
});

function multiply(a: number[], b: number[]) {
  return [
    a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!,
    a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!,
    a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!,
    a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!
  ];
}
function inverse(q: number[]) { return [-q[0]!, -q[1]!, -q[2]!, q[3]!]; }
function vector(packet: DataView, offset: number, count: number) {
  return Array.from({ length: count }, (_, i) => packet.getFloat32(offset + i * 4, true));
}
function near(actual: number[], expected: number[], message: string) {
  actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]!) < .001,
    `${message}: ${actual} != ${expected}`));
}
function worldVelocity(packet: DataView) {
  const q = vector(packet, 16, 4);
  return multiply(multiply(q, [...vector(packet, 32, 3), 0]), inverse(q)).slice(0, 3);
}

test("saved axis swaps that turned down into right retain down and right world directions", () => {
  const fixture = controller({ mapping: { x: "z", y: "y", z: "x" } });
  fixture.window.dispatch("deviceorientation", { alpha: 0, beta: 0, gamma: 0 });
  fixture.window.dispatch("devicemotion", { rotationRate: { alpha: -480, beta: 0, gamma: 0 } });
  fixture.send();
  const down = fixture.packets.at(-1)!;
  assert.equal(down.byteLength, 56);
  // Golden wire values are also exercised through Unity's packet decoder and
  // character menu: down selects red; right selects the next character.
  near(vector(down, 16, 4), [-Math.SQRT1_2, 0, Math.SQRT1_2, 0], "orientation");
  near(vector(down, 32, 3), [0, 0, 480], "down body gyro");
  near(worldVelocity(down), [-480, 0, 0], "down world gyro");
  fixture.window.dispatch("devicemotion", { rotationRate: { alpha: 0, beta: 0, gamma: -480 } });
  fixture.send();
  near(vector(fixture.packets.at(-1)!, 32, 3), [-480, 0, 0], "right body gyro");
  near(worldVelocity(fixture.packets.at(-1)!), [0, 0, 480], "right world gyro");
});

test("physical browser events produce the packets used by Unity's character menu tests", () => {
  const cases = [
    { posture: { alpha: 0, beta: 0, gamma: 0 }, screen: 0,
      q: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
      rawDown: [-480, 0, 0], rawRight: [0, 0, -480], down: [-480, 0, 0], right: [0, -480, 0] },
    { posture: { alpha: 0, beta: 0, gamma: -90 }, screen: 0,
      q: [-.5, .5, .5, .5],
      rawDown: [0, 0, 480], rawRight: [-480, 0, 0], down: [0, 480, 0], right: [-480, 0, 0] },
    { posture: { alpha: 0, beta: 0, gamma: 0 }, screen: 90,
      q: [-.5, -.5, .5, .5],
      rawDown: [-480, 0, 0], rawRight: [0, 0, -480], down: [0, 0, 480], right: [0, -480, 0] }
  ];
  for (const value of cases) {
    const fixture = controller(undefined, value.screen);
    fixture.window.dispatch("deviceorientation", value.posture);
    for (const [raw, expected] of [[value.rawDown, value.down], [value.rawRight, value.right]]) {
      const [alpha, beta, gamma] = raw!;
      fixture.window.dispatch("devicemotion", { rotationRate: { alpha, beta, gamma } });
      fixture.send();
      const packet = fixture.packets.at(-1)!;
      near(vector(packet, 16, 4), value.q, "Unity wire orientation");
      near(vector(packet, 32, 3), expected!, "Unity wire gyro");
    }
  }
});

// Device orientation is Rz(alpha) * Rx(beta) * Ry(gamma), but rotationRate
// alpha/beta/gamma are rates about device X/Y/Z respectively (not Z/X/Y).
// Derive device readings from physical world motion using the specification's
// matrix, independently of controller.js's quaternion and axis helpers.
function deviceToEarthMatrix(alpha: number, beta: number, gamma: number) {
  const [a, b, g] = [alpha, beta, gamma].map(value => value * Math.PI / 180);
  const [ca, sa, cb, sb, cg, sg] = [Math.cos(a!), Math.sin(a!), Math.cos(b!),
    Math.sin(b!), Math.cos(g!), Math.sin(g!)];
  return [
    [ca! * cg! - sa! * sb! * sg!, -sa! * cb!, ca! * sg! + sa! * sb! * cg!],
    [sa! * cg! + ca! * sb! * sg!, ca! * cb!, sa! * sg! - ca! * sb! * cg!],
    [-cb! * sg!, sb!, cb! * cg!]
  ];
}

function deviceVector(matrix: number[][], earthVector: number[]) {
  return [0, 1, 2].map(column => earthVector.reduce(
    (sum, value, row) => sum + matrix[row]![column]! * value, 0));
}

test("physical swings keep their menu direction with every phone posture and screen angle", () => {
  const postures = [
    { alpha: 0, beta: 0, gamma: 0 }, // Screen up.
    { alpha: 0, beta: 90, gamma: 0 }, // Upright.
    { alpha: 0, beta: 0, gamma: -90 }, // Screen left.
    { alpha: 0, beta: 0, gamma: 90 }, // Screen right.
    { alpha: 0, beta: -180, gamma: 0 }, // Screen down.
    { alpha: 37, beta: 23, gamma: -62 }
  ];
  const configurations = [undefined,
    { mapping: { x: "z", y: "y", z: "x" } },
    { mapping: { x: "y", y: "x", z: "z" }, direction: { x: -1, y: 1, z: -1 },
      adjustment: { x: 25, y: -40, z: 15 } }];
  // Earth axes: right, forward, up. Raising a forward sword rotates around
  // +X; swinging left rotates around +Z. Twist around forward must be ignored.
  const swings = [
    { name: "up", earth: [480, 0, 0], menu: [0, 480] },
    { name: "down", earth: [-480, 0, 0], menu: [0, -480] },
    { name: "left", earth: [0, 0, 480], menu: [-480, 0] },
    { name: "right", earth: [0, 0, -480], menu: [480, 0] },
    { name: "forward twist", earth: [0, 480, 0], menu: [0, 0] }
  ];
  for (const posture of postures) for (const screenAngle of [0, 90, 180, 270])
    for (const configuration of configurations) {
      const fixture = controller(configuration, screenAngle);
      fixture.window.dispatch("deviceorientation", posture);
      const matrix = deviceToEarthMatrix(posture.alpha, posture.beta, posture.gamma);
      for (const swing of swings) {
        const [alpha, beta, gamma] = deviceVector(matrix, swing.earth);
        fixture.window.dispatch("devicemotion", { rotationRate: { alpha, beta, gamma } });
        fixture.send();
        const packet = fixture.packets.at(-1)!;
        assert.equal(packet.getUint8(1) & 6, 6);
        const world = worldVelocity(packet);
        near(world, [swing.earth[0]!, -swing.earth[1]!, -swing.earth[2]!],
          `${swing.name}, posture=${JSON.stringify(posture)}, screen=${screenAngle}`);
        // The Unity codec's handedness reflection and phone world correction
        // project wire world Z to menu right and world X to menu up.
        near([world[2]!, world[0]!], swing.menu, swing.name + " menu speed");
      }
    }
});

test("landscape acceleration and posture refer to the same physical frame", () => {
  const posture = { alpha: 37, beta: 23, gamma: -62 };
  const earth = [2, 3, 5];
  const [x, y, z] = deviceVector(deviceToEarthMatrix(posture.alpha, posture.beta, posture.gamma), earth);
  for (const screenAngle of [0, 90, 180, 270]) {
    const fixture = controller(undefined, screenAngle);
    fixture.window.dispatch("deviceorientation", posture);
    fixture.window.dispatch("devicemotion", { acceleration: { x, y, z } });
    fixture.send();
    const packet = fixture.packets.at(-1)!;
    const q = vector(packet, 16, 4);
    const world = multiply(multiply(q, [...vector(packet, 44, 3), 0]), inverse(q)).slice(0, 3);
    // Polar acceleration has the opposite mapping parity to axial velocity.
    near(world, [-earth[0]!, earth[1]!, earth[2]!], `screen=${screenAngle}`);
  }
});

test("all saved axis permutations and inversions keep world velocity and calibrated sword motion", () => {
  const axes = ["x", "y", "z"];
  const permutations = ["xyz", "xzy", "yxz", "yzx", "zxy", "zyx"];
  const adjustment = { x: 25, y: -40, z: 15 };
  const axisQ = (axis: number, degrees: number) => {
    const q = [0, 0, 0, Math.cos(degrees * Math.PI / 360)];
    q[axis] = Math.sin(degrees * Math.PI / 360); return q;
  };
  const correction = multiply(multiply(axisQ(0, adjustment.x), axisQ(1, adjustment.y)), axisQ(2, adjustment.z));
  for (const screenAngle of [0, 90, 180, 270]) {
    const baseline = controller({ adjustment }, screenAngle);
    baseline.window.dispatch("deviceorientation", { alpha: 15, beta: 37, gamma: -8 });
    baseline.window.dispatch("devicemotion", { rotationRate: { beta: 230, gamma: -470, alpha: 60 } });
    baseline.send();
    const expectedVelocity = worldVelocity(baseline.packets.at(-1)!);
    for (const permutation of permutations) for (let signs = 0; signs < 8; signs++) {
      const mapping = Object.fromEntries(axes.map((axis, i) => [axis, permutation[i]]));
      const direction = Object.fromEntries(axes.map((axis, i) => [axis, signs & (1 << i) ? -1 : 1]));
      const fixture = controller({ mapping, direction, adjustment }, screenAngle);
      // Original packets conjugated the entire orientation by the body mapping.
      // Their calibrated relative pose must be preserved by the fixed world frame.
      const order = axes.map(axis => axes.indexOf(mapping[axis]!));
      const parity = ((order[0]! - order[1]!) * (order[1]! - order[2]!) * (order[0]! - order[2]!) < 0) ? 1 : -1;
      const sign = axes.map((axis, i) => (i < 2 ? -1 : 1) * direction[axis]!);
      const determinant = parity * sign.reduce((a, b) => a * b, 1);
      const legacy = () => {
        const q = multiply(Array.from(fixture.state.orientation), correction);
        return [...order.map((index, i) => determinant * sign[i]! * q[index]!), q[3]!];
      };
      fixture.window.dispatch("deviceorientation", { alpha: 0, beta: 12, gamma: 27 });
      fixture.send();
      const first = vector(fixture.packets.at(-1)!, 16, 4);
      const legacyFirst = legacy();
      fixture.window.dispatch("deviceorientation", { alpha: 15, beta: 37, gamma: -8 });
      fixture.window.dispatch("devicemotion", { rotationRate: { beta: 230, gamma: -470, alpha: 60 } });
      fixture.send();
      const packet = fixture.packets.at(-1)!;
      const label = `${permutation}, signs=${signs}, screen=${screenAngle}`;
      near(worldVelocity(packet), expectedVelocity, label + " world velocity");
      const relative = multiply(inverse(first), vector(packet, 16, 4));
      const legacyRelative = multiply(inverse(legacyFirst), legacy());
      // q and -q represent the same pose.
      const sameSign = relative.reduce((sum, value, i) => sum + value * legacyRelative[i]!, 0) >= 0;
      near(relative, legacyRelative.map(value => sameSign ? value : -value), label + " sword pose");
    }
  }
});


test("registration hello identifies the phone and axis preview commits only on explicit confirmation", () => {
  const page = controller();
  const channel = page.connect();
  const hello = page.messages.find(message => message.type === "controller.hello");
  assert.ok(hello?.deviceId.length >= 8);
  assert.equal(hello.order, 1); // Existing XZY baseline.
  channel.dispatch("message", { data: JSON.stringify({ type: "controller.ready" }) });
  channel.dispatch("message", { data: JSON.stringify({ type: "axis.configure", order: 5, signs: 7, request: 1 }) });
  assert.deepEqual({ ...page.state.axisMapping }, { x: "z", y: "y", z: "x" });
  assert.deepEqual({ ...page.state.axisDirection }, { x: -1, y: -1, z: -1 });
  assert.equal(page.messages.at(-1).request, 1);
  channel.dispatch("message", { data: JSON.stringify({ type: "axis.cancel", order: 1, signs: 0, request: 2 }) });
  assert.deepEqual({ ...page.state.axisMapping }, { x: "x", y: "z", z: "y" });
  assert.deepEqual({ ...page.state.axisDirection }, { x: 1, y: 1, z: 1 });
  channel.dispatch("message", { data: JSON.stringify({ type: "axis.configure", order: 5, signs: 7, request: 1 }) });
  assert.deepEqual({ ...page.state.axisMapping }, { x: "x", y: "z", z: "y" }, "Delayed preview cannot undo cancellation.");
  channel.dispatch("message", { data: JSON.stringify({ type: "axis.commit", order: 3, signs: 5, request: 3 }) });
  assert.equal(page.messages.at(-1).order, 3); assert.equal(page.messages.at(-1).signs, 5);
});

test("all six axis orders and eight sign masks can be previewed without changing another phone", () => {
  const page = controller(), other = controller();
  const channel = page.connect();
  for (let order = 0; order < 6; order++) for (let signs = 0; signs < 8; signs++) {
    const request = 1 + order * 8 + signs;
    channel.dispatch("message", { data: JSON.stringify({ type: "axis.configure", order, signs, request }) });
    assert.equal(page.messages.at(-1).order, order); assert.equal(page.messages.at(-1).signs, signs);
    assert.equal(new Set(Object.values(page.state.axisMapping)).size, 3);
    assert.deepEqual({ ...other.state.axisMapping }, { x: "x", y: "z", z: "y" });
  }
  channel.dispatch("message", { data: JSON.stringify({ type: "axis.configure", order: 6, signs: 8, request: 99 }) });
  assert.equal(page.messages.at(-1).request, 48, "Malformed settings are ignored.");
});

test("axis configuration changes transmitted gyroscope directions, not only stored settings", () => {
  const page = controller();
  const channel = page.connect();
  page.state.gyroscope = [11, 23, 37];
  page.state.gyroscopeValid = true;
  const packets = new Set<string>();
  for (let order = 0; order < 6; order++) {
    const values = [];
    for (let signs = 0; signs < 2; signs++) {
      channel.dispatch("message", { data: JSON.stringify({ type: "axis.configure", order, signs, request: 1 + order * 2 + signs }) });
      const ack = page.messages.at(-1);
      page.send();
      const packet = page.packets.at(-1)!;
      assert.equal(packet.getUint32(4, true), ack.nextSequence);
      values.push([32, 36, 40].map(offset => packet.getFloat32(offset, true)));
    }
    assert.notDeepEqual(values[0], values[1], "Reversing an axis changes motion packets.");
    packets.add(JSON.stringify(values[0]));
  }
  assert.equal(packets.size, 6, "All six orders must transmit different axis mappings for the same physical motion.");
});
