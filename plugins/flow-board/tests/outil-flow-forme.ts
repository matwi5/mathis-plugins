// La forme du schéma de l'outil `flow` (clés, types, valeurs admises, champs requis : tout sauf ses
// descriptions), relevée le 06/11/2026 avant que ses textes soient raccourcis : `outil-flow-textes.test.ts`
// la compare au schéma d'aujourd'hui. Un module d'aide, pas un fichier de test ; à changer seulement avec
// une clé, un type ou une valeur admise de l'outil.

export const TOOL_SHAPE: unknown = {
  "properties": {
    "card": {
      "properties": {
        "alts": {
          "items": {
            "enum": [
              "grill-with-docs",
              "to-spec",
              "to-tickets",
              "implement",
              "tdd",
              "diagnosing-bugs",
              "triage",
              "improve-codebase-architecture",
              "code-review",
              "research",
              "to-questionnaire",
              "wizard",
              "prototype"
            ],
            "type": "string"
          },
          "type": "array"
        },
        "askMatt": {
          "type": "string"
        },
        "effort": {
          "enum": [
            "medium",
            "high",
            "xhigh"
          ],
          "type": "string"
        },
        "effortWhy": {
          "type": "string"
        },
        "folder": {
          "type": "string"
        },
        "idea": {
          "type": "string"
        },
        "mode": {
          "enum": [
            "auto",
            "manual"
          ],
          "type": "string"
        },
        "modeWhy": {
          "type": "string"
        },
        "start": {
          "enum": [
            "grill-with-docs",
            "to-spec",
            "to-tickets",
            "implement",
            "tdd",
            "diagnosing-bugs",
            "triage",
            "improve-codebase-architecture",
            "code-review",
            "research",
            "to-questionnaire",
            "wizard",
            "prototype"
          ],
          "type": "string"
        },
        "title": {
          "type": "string"
        }
      },
      "required": [
        "title",
        "start",
        "askMatt",
        "mode",
        "effort",
        "folder"
      ],
      "type": "object"
    },
    "closed": {
      "items": {
        "properties": {
          "branch": {
            "type": "string"
          },
          "group": {
            "type": "string"
          },
          "items": {
            "type": "string"
          },
          "sessionId": {
            "type": "string"
          },
          "state": {
            "enum": [
              "closed",
              "app",
              "stopped"
            ],
            "type": "string"
          },
          "why": {
            "type": "string"
          },
          "worktree": {
            "type": "string"
          }
        },
        "required": [
          "state"
        ],
        "type": "object"
      },
      "type": "array"
    },
    "complete": {
      "type": "boolean"
    },
    "coordinate": {
      "properties": {
        "answer": {
          "items": {
            "properties": {
              "file": {
                "type": "string"
              },
              "mission": {
                "type": "string"
              },
              "question": {
                "type": "string"
              },
              "seen": {
                "type": "string"
              },
              "series": {
                "type": "number"
              }
            },
            "required": [
              "mission",
              "question",
              "seen",
              "file",
              "series"
            ],
            "type": "object"
          },
          "type": "array"
        },
        "close": {
          "items": {
            "properties": {
              "mission": {
                "type": "string"
              }
            },
            "required": [
              "mission"
            ],
            "type": "object"
          },
          "type": "array"
        },
        "cutAuto": {
          "items": {
            "properties": {
              "mission": {
                "type": "string"
              }
            },
            "required": [
              "mission"
            ],
            "type": "object"
          },
          "type": "array"
        },
        "instruct": {
          "items": {
            "properties": {
              "file": {
                "type": "string"
              },
              "mission": {
                "type": "string"
              },
              "origin": {
                "enum": [
                  "user",
                  "coo"
                ],
                "type": "string"
              },
              "series": {
                "type": "number"
              }
            },
            "required": [
              "mission",
              "file",
              "series",
              "origin"
            ],
            "type": "object"
          },
          "type": "array"
        },
        "nightOn": {
          "type": "boolean"
        },
        "night": {
          "items": {
            "properties": {
              "act": {
                "type": "string"
              },
              "group": {
                "type": "string"
              },
              "mission": {
                "type": "string"
              },
              "watch": {
                "type": "string"
              }
            },
            "required": [
              "mission",
              "watch",
              "act"
            ],
            "type": "object"
          },
          "type": "array"
        },
        "compatible": {
          "items": {
            "properties": {
              "missions": {
                "items": {
                  "type": "string"
                },
                "type": "array"
              },
              "subject": {
                "type": "string"
              }
            },
            "required": [
              "missions",
              "subject"
            ],
            "type": "object"
          },
          "type": "array"
        },
        "contradiction": {
          "items": {
            "properties": {
              "first": {
                "properties": {
                  "mission": {
                    "type": "string"
                  },
                  "ref": {
                    "type": "string"
                  },
                  "text": {
                    "type": "string"
                  }
                },
                "required": [
                  "mission",
                  "ref",
                  "text"
                ],
                "type": "object"
              },
              "second": {
                "properties": {
                  "mission": {
                    "type": "string"
                  },
                  "ref": {
                    "type": "string"
                  },
                  "text": {
                    "type": "string"
                  }
                },
                "required": [
                  "mission",
                  "ref",
                  "text"
                ],
                "type": "object"
              },
              "subject": {
                "type": "string"
              }
            },
            "required": [
              "first",
              "second",
              "subject"
            ],
            "type": "object"
          },
          "type": "array"
        },
        "decisionsSeen": {
          "type": "boolean"
        },
        "gleaned": {
          "items": {
            "type": "string"
          },
          "type": "array"
        },
        "gleanedExisting": {
          "type": "boolean"
        },
        "redo": {
          "items": {
            "properties": {
              "file": {
                "type": "string"
              },
              "mission": {
                "type": "string"
              },
              "series": {
                "type": "number"
              }
            },
            "required": [
              "mission",
              "file",
              "series"
            ],
            "type": "object"
          },
          "type": "array"
        },
        "taken": {
          "items": {
            "properties": {
              "by": {
                "properties": {
                  "mission": {
                    "type": "string"
                  },
                  "ticket": {
                    "type": "string"
                  }
                },
                "required": [
                  "mission",
                  "ticket"
                ],
                "type": "object"
              },
              "item": {
                "type": "string"
              },
              "mission": {
                "type": "string"
              }
            },
            "required": [
              "mission",
              "item",
              "by"
            ],
            "type": "object"
          },
          "type": "array"
        }
      },
      "type": "object"
    },
    "decided": {
      "items": {
        "properties": {
          "origin": {
            "enum": [
              "recommendation",
              "skipped-validation",
              "linked-session"
            ],
            "type": "string"
          },
          "what": {
            "type": "string"
          },
          "why": {
            "type": "string"
          }
        },
        "required": [
          "what"
        ],
        "type": "object"
      },
      "type": "array"
    },
    "delegate": {
      "type": "string"
    },
    "delivery": {
      "properties": {
        "detail": {
          "type": "string"
        },
        "ok": {
          "type": "boolean"
        },
        "step": {
          "enum": [
            "version",
            "push",
            "pr",
            "project"
          ],
          "type": "string"
        }
      },
      "required": [
        "step",
        "ok"
      ],
      "type": "object"
    },
    "externals": {
      "items": {
        "properties": {
          "id": {
            "type": "string"
          },
          "kind": {
            "enum": [
              "decision",
              "task"
            ],
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "status": {
            "enum": [
              "todo",
              "done"
            ],
            "type": "string"
          }
        },
        "required": [
          "id",
          "name"
        ],
        "type": "object"
      },
      "type": "array"
    },
    "fix": {
      "properties": {
        "phase": {
          "type": "string"
        },
        "step": {
          "type": "string"
        },
        "title": {
          "type": "string"
        }
      },
      "type": "object"
    },
    "group": {
      "type": "string"
    },
    "groups": {
      "items": {
        "properties": {
          "files": {
            "items": {
              "type": "string"
            },
            "type": "array"
          },
          "id": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "resources": {
            "items": {
              "type": "string"
            },
            "type": "array"
          },
          "tickets": {
            "items": {
              "type": "string"
            },
            "type": "array"
          },
          "why": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "name",
          "tickets"
        ],
        "type": "object"
      },
      "type": "array"
    },
    "items": {
      "items": {
        "properties": {
          "id": {
            "type": "string"
          },
          "label": {
            "type": "string"
          },
          "status": {
            "enum": [
              "todo",
              "doing",
              "done",
              "dropped"
            ],
            "type": "string"
          }
        },
        "required": [
          "id",
          "label"
        ],
        "type": "object"
      },
      "type": "array"
    },
    "launch": {
      "type": "string"
    },
    "main": {
      "type": "string"
    },
    "model": {
      "type": "string"
    },
    "pistes": {
      "items": {
        "properties": {
          "files": {
            "items": {
              "type": "string"
            },
            "type": "array"
          },
          "op": {
            "enum": [
              "add",
              "edit",
              "comment",
              "drop"
            ],
            "type": "string"
          },
          "piste": {
            "type": "string"
          },
          "reason": {
            "type": "string"
          },
          "text": {
            "type": "string"
          }
        },
        "required": [
          "op",
          "piste"
        ],
        "type": "object"
      },
      "type": "array"
    },
    "note": {
      "type": "string"
    },
    "open": {
      "properties": {
        "entry": {
          "type": "string"
        },
        "title": {
          "type": "string"
        }
      },
      "required": [
        "title"
      ],
      "type": "object"
    },
    "remove": {
      "items": {
        "type": "string"
      },
      "type": "array"
    },
    "report": {
      "type": "string"
    },
    "reportPath": {
      "type": "string"
    },
    "resume": {
      "type": "string"
    },
    "returned": {
      "items": {
        "type": "string"
      },
      "type": "array"
    },
    "review": {
      "properties": {
        "bugs": {
          "type": "number"
        },
        "fixed": {
          "type": "number"
        },
        "form": {
          "type": "number"
        },
        "group": {
          "type": "string"
        },
        "spec": {
          "type": "number"
        },
        "standards": {
          "type": "number"
        },
        "ticket": {
          "type": "string"
        }
      },
      "type": "object"
    },
    "reviewed": {
      "items": {
        "type": "string"
      },
      "type": "array"
    },
    "security": {
      "properties": {
        "advised": {
          "type": "boolean"
        },
        "dismissed": {
          "type": "number"
        },
        "findings": {
          "type": "number"
        },
        "fixed": {
          "type": "number"
        },
        "group": {
          "type": "string"
        },
        "why": {
          "type": "string"
        }
      },
      "type": "object"
    },
    "set": {
      "items": {
        "properties": {
          "id": {
            "type": "string"
          },
          "status": {
            "enum": [
              "todo",
              "doing",
              "done",
              "blocked"
            ],
            "type": "string"
          },
          "why": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "status"
        ],
        "type": "object"
      },
      "type": "array"
    },
    "setAside": {
      "items": {
        "properties": {
          "source": {
            "type": "string"
          },
          "text": {
            "type": "string"
          }
        },
        "required": [
          "text"
        ],
        "type": "object"
      },
      "type": "array"
    },
    "step": {
      "type": "string"
    },
    "tickets": {
      "items": {
        "properties": {
          "blockedBy": {
            "items": {
              "type": "string"
            },
            "type": "array"
          },
          "files": {
            "items": {
              "type": "string"
            },
            "type": "array"
          },
          "id": {
            "type": "string"
          },
          "logic": {
            "type": "boolean"
          },
          "name": {
            "type": "string"
          },
          "sensitive": {
            "type": "boolean"
          },
          "status": {
            "enum": [
              "todo",
              "doing",
              "done",
              "blocked"
            ],
            "type": "string"
          },
          "why": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "name"
        ],
        "type": "object"
      },
      "type": "array"
    },
    "title": {
      "type": "string"
    },
    "waiting": {
      "items": {
        "properties": {
          "answered": {
            "type": "boolean"
          },
          "dismissed": {
            "type": "number"
          },
          "gesture": {
            "enum": [
              "spend",
              "external",
              "flaw"
            ],
            "type": "string"
          },
          "group": {
            "type": "string"
          },
          "id": {
            "type": "string"
          },
          "phase": {
            "type": "string"
          },
          "text": {
            "type": "string"
          },
          "ticket": {
            "type": "string"
          }
        },
        "required": [
          "id"
        ],
        "type": "object"
      },
      "type": "array"
    },
    "withdrawn": {
      "items": {
        "properties": {
          "replacedBy": {
            "type": "string"
          },
          "what": {
            "type": "string"
          },
          "why": {
            "type": "string"
          }
        },
        "required": [
          "what",
          "why"
        ],
        "type": "object"
      },
      "type": "array"
    }
  },
  "type": "object"
}
