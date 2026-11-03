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

  invalidateSite(siteId: string): void {
    for (const [key, val] of Object.entries(this.entities)) {
      if (key === '__observed' && val && typeof val === 'object') {
        const cleanedObserved: Record<string, unknown[]> = {};
        for (const [res, list] of Object.entries(val as Record<string, unknown[]>)) {
          if (Array.isArray(list)) {
            cleanedObserved[res] = list.filter((item) => {
              if (item && typeof item === 'object') {
                const sId = (item as Record<string, unknown>).siteId ?? (item as Record<string, unknown>).id;
                return sId !== siteId;
              }
              return true;
            });
          } else {
            cleanedObserved[res] = list;
          }
        }
        this.entities[key] = cleanedObserved;
      } else if (Array.isArray(val)) {
        this.entities[key] = val.filter((item) => {
          if (item && typeof item === 'object') {
            const sId = (item as Record<string, unknown>).siteId ?? (item as Record<string, unknown>).id;
            return sId !== siteId;
          }
          return true;
        });
      } else if (val && typeof val === 'object') {
        const sId = (val as Record<string, unknown>).siteId ?? (val as Record<string, unknown>).id;
        if (sId === siteId) {
          delete this.entities[key];
        }
      }
    }
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
