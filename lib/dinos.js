import { logger } from "./config";

class Dino {
  constructor(fullProfile) {
    this.userId = fullProfile.user_id.value;
    this.employeeId = fullProfile.access_information.hris.values.EmployeeID;
    this.managerId =
      fullProfile.access_information.hris.values.WorkersManagersEmployeeID;
    this.data = _slimDownProfile(fullProfile, this.userId);
  }
}

class DinoNode {
  constructor(parent, firstChild, numChildren, dino) {
    this.parent = parent;
    this.firstChild = firstChild;
    this.numChildren = numChildren;
    this.dino = dino;
  }
}

class DinoTree {
  constructor(dinos = []) {
    this.tree = [];
    this.id_to_index = new Map();
    this._init(dinos);
  }

  _init(dinos) {
    const roots = _findRoots(dinos);
    roots.sort(_compareDinos);
    for (let i = 0; i < roots.length; i++) {
      const dino = roots[i];
      this.id_to_index.set(dino.userId, i);
      this.tree.push(new DinoNode(-1, undefined, 0, dino));
    }
    logger.info(`got ${this.tree.length} roots in tree`);
    this._populate(dinos, 0);
  }

  _populate(dinos, currentDinoIndex) {
    if (currentDinoIndex >= this.tree.length) {
      return;
    }
    const node = this.tree[currentDinoIndex];
    const dino = node.dino;
    const directs = _findDirects(dinos, dino.employeeId);
    directs.sort(_compareDinos);
    const firstChild = this.tree.length;
    let numChildren = directs.length;
    for (const direct of directs) {
      this.id_to_index.set(direct.userId, this.tree.length);
      this.tree.push(new DinoNode(currentDinoIndex, undefined, 0, direct));
    }
    node.firstChild = firstChild;
    node.numChildren = numChildren;
    this._populate(dinos, currentDinoIndex + 1);
  }

  _findHerd(node) {
    const children = [];
    if (node.firstChild) {
      for (let i = 0; i < node.numChildren; i++) {
        let child = this.tree[node.firstChild + i];
        let herd = this._findHerd(child);
        children.push(herd);
      }
    }
    return {
      data: node.dino.data,
      children
    };
  }

  _withSiblings(node, children) {
    let index = this._badIndex(node.parent)
      ? 0
      : this.tree[node.parent].firstChild;
    const siblings = [];
    let next = this.tree[index];
    while (next && next.dino.userId !== node.dino.userId) {
      siblings.push({ data: next.dino.data, children: [] });
      next = this.tree[++index];
    }
    siblings.push({ data: node.dino.data, children });
    next = this.tree[++index];
    while (next && next.parent === node.parent) {
      siblings.push({ data: next.dino.data, children: [] });
      next = this.tree[++index];
    }
    return siblings;
  }

  _traceIndex(node, index, trace) {
    if (this._badIndex(node.parent)) {
      trace.push(index);
      return trace;
    }
    let first = this.tree[node.parent].firstChild;
    trace.push(index - first);
    return this._traceIndex(this.tree[node.parent], node.parent, trace);
  }

  _walkUp(node, children = []) {
    const data = this._withSiblings(node, children);
    const parentIndex = node.parent;
    if (this._badIndex(parentIndex)) {
      return data;
    }
    const parent = this.tree[parentIndex];
    return this._walkUp(parent, data);
  }

  _directsData(node) {
    if (typeof node.firstChild !== "undefined") {
      return this.tree
        .slice(node.firstChild, node.firstChild + node.numChildren)
        .map(n => n.dino.data);
    }
    return [];
  }

  _badIndex(index) {
    return (
      typeof index === "undefined" || index < 0 || index >= this.tree.length
    );
  }

  fullOrgchart() {
    const full = [];
    for (let i = 0; i < this.tree.length; i++) {
      const root = this.tree[i];
      if (root.parent > -1) {
        break;
      }
      const herd = this._findHerd(root);
      full.push(herd);
    }
    return full;
  }

  related(userId) {
    const index = this.id_to_index.get(userId);
    if (this._badIndex(index)) {
      return { error: `unknown userid: ${userId}` };
    }
    const node = this.tree[index];
    const manager = node.parent > -1 ? this.tree[node.parent].dino.data : null;
    const directs = this._directsData(node);
    return {
      manager: manager,
      directs: directs
    };
  }

  directs(userId) {
    const index = this.id_to_index.get(userId);
    if (this._badIndex(index)) {
      return { error: `unknown userid: ${userId}` };
    }
    const node = this.tree[index];
    return this._directsData(node);
  }

  expanded(userId) {
    const index = this.id_to_index.get(userId);
    if (this._badIndex(index)) {
      return { error: `unknown userid: ${userId}` };
    }
    const node = this.tree[index];
    return this._walkUp(node);
  }

  trace(userId) {
    const index = this.id_to_index.get(userId);
    if (this._badIndex(index)) {
      return { error: `unknown userid: ${userId}` };
    }
    const node = this.tree[index];
    const trace = this._traceIndex(node, index, []);
    trace.reverse();
    return {
      trace: trace.join("-")
    };
  }
}

function _findDirects(dinos, managerId) {
  return dinos.filter(d => d.managerId === managerId);
}

function _findRoots(dinos) {
  const currentIds = new Set(dinos.map(d => d.employeeId));
  return dinos.filter(d => !d.managerId || !currentIds.has(d.managerId));
}

function _compareDinos(a, b) {
  if (a.data.first_name < b.data.first_name) {
    return -1;
  }
  if (a.data.first_name > b.data.first_name) {
    return 1;
  }
  if (a.data.last_name < b.data.last_name) {
    return -1;
  }
  if (a.data.last_name > b.data.last_name) {
    return 1;
  }
  return 0;
}

function getStaffField(fullProfile, field) {
  try {
    if (
      field in fullProfile // &&
      // fullProfile[field].metadata.visibility !== "private"
    ) {
      return fullProfile[field].value;
    }
  } catch (_) {
    logger.error(`missing field ${field}`);
  }
  return null;
}

function _slimDownProfile(fullProfile, userId) {
  return {
    ["user_id"]: userId,
    ["first_name"]: fullProfile.first_name.value,
    ["last_name"]: getStaffField(fullProfile, "last_name"),
    picture: fullProfile.picture.value,
    title: getStaffField(fullProfile, "business_title"),
    ["fun_title"]: getStaffField(fullProfile, "fun_title"),
    location: getStaffField(fullProfile, "location_preference")
  };
}

export { DinoTree, Dino };
