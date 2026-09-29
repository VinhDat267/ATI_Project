export interface ResolvedMember {
  id: string;
  name: string;
  username?: string;
}

export class WorkingMemory {
  private entities: Record<string, any> = {};
  private members: ResolvedMember[] = [];

  setEntity(key: string, value: any): void {
    this.entities[key] = value;
  }

  getEntity<T = any>(key: string): T | undefined {
    return this.entities[key];
  }

  deleteEntity(key: string): void {
    delete this.entities[key];
  }

  addMember(member: ResolvedMember): void {
    const existingIndex = this.members.findIndex((m) => m.id === member.id);
    if (existingIndex >= 0) {
      this.members[existingIndex] = member;
    } else {
      this.members.push(member);
    }
  }

  getMembers(): ResolvedMember[] {
    return [...this.members];
  }

  getAll(): Record<string, any> {
    return this.toJSON();
  }

  toJSON(): Record<string, any> {
    return {
      ...this.entities,
      ...(this.members.length > 0 ? { members: this.members } : {}),
    };
  }

  fromJSON(data: Record<string, any>): void {
    this.entities = {};
    this.members = [];
    if (Array.isArray(data.members)) {
      this.members = [...data.members];
    }
    for (const [k, v] of Object.entries(data)) {
      if (k !== 'members') {
        this.entities[k] = v;
      }
    }
  }

  toPromptString(): string {
    const json = this.toJSON();
    if (Object.keys(json).length === 0) {
      return 'No entities resolved yet.';
    }
    return JSON.stringify(json, null, 2);
  }

  clear(): void {
    this.entities = {};
    this.members = [];
  }
}
