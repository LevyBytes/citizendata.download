globalThis.CITIZENDATA_OFFLINE_SCHEMA = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "RSI Player Dashboard Offline Package Manifest",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "packageVersion",
    "packageId",
    "generatedAt",
    "generator",
    "dashboardVersion",
    "parserVersion",
    "imageUrlNormalizationVersion",
    "account",
    "sourceExport",
    "priorPackage",
    "policy",
    "entryPoint",
    "assets",
    "summary",
    "materializationReceipt",
    "files",
    "integrity"
  ],
  "properties": {
    "packageVersion": {
      "const": 1
    },
    "packageId": {
      "type": "string",
      "format": "uuid"
    },
    "generatedAt": {
      "$ref": "#/$defs/dateTime"
    },
    "generator": {
      "$ref": "#/$defs/generator"
    },
    "dashboardVersion": {
      "type": "string",
      "minLength": 1
    },
    "parserVersion": {
      "type": "string",
      "minLength": 1
    },
    "imageUrlNormalizationVersion": {
      "type": "integer",
      "minimum": 1
    },
    "account": {
      "$ref": "#/$defs/accountIdentity"
    },
    "sourceExport": {
      "$ref": "#/$defs/sourceExport"
    },
    "priorPackage": {
      "oneOf": [
        {
          "$ref": "#/$defs/priorPackage"
        },
        {
          "type": "null"
        }
      ]
    },
    "policy": {
      "$ref": "#/$defs/downloadPolicy"
    },
    "entryPoint": {
      "$ref": "#/$defs/safeRelativePath"
    },
    "assets": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/asset"
      }
    },
    "summary": {
      "$ref": "#/$defs/summary"
    },
    "materializationReceipt": {
      "$ref": "#/$defs/materializationReceipt"
    },
    "files": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/fileReceipt"
      }
    },
    "integrity": {
      "$ref": "#/$defs/integrity"
    }
  },
  "$defs": {
    "dateTime": {
      "type": "string",
      "format": "date-time"
    },
    "nullableDateTime": {
      "oneOf": [
        {
          "$ref": "#/$defs/dateTime"
        },
        {
          "type": "null"
        }
      ]
    },
    "nullableString": {
      "type": [
        "string",
        "null"
      ]
    },
    "nullableInteger": {
      "type": [
        "integer",
        "null"
      ],
      "minimum": 0
    },
    "sha256": {
      "type": "string",
      "pattern": "^[a-f0-9]{64}$"
    },
    "safeRelativePath": {
      "type": "string",
      "minLength": 1,
      "pattern": "^(?!/)(?!\\.\\.(?:/|$))(?!.*\\/\\.\\.(?:\\/|$))[A-Za-z0-9._/-]+$"
    },
    "generator": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name",
        "version"
      ],
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1
        },
        "version": {
          "type": "string",
          "minLength": 1
        }
      }
    },
    "accountIdentity": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "localAccountId",
        "handle"
      ],
      "properties": {
        "localAccountId": {
          "type": "string",
          "format": "uuid"
        },
        "handle": {
          "$ref": "#/$defs/nullableString"
        }
      }
    },
    "sourceExport": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schemaVersion",
        "exportedAt",
        "contentHash"
      ],
      "properties": {
        "schemaVersion": {
          "type": "integer",
          "minimum": 1
        },
        "exportedAt": {
          "$ref": "#/$defs/dateTime"
        },
        "contentHash": {
          "$ref": "#/$defs/sha256"
        }
      }
    },
    "priorPackage": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "packageId",
        "manifestHash"
      ],
      "properties": {
        "packageId": {
          "type": "string",
          "format": "uuid"
        },
        "manifestHash": {
          "$ref": "#/$defs/sha256"
        }
      }
    },
    "downloadPolicy": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "allowedImageHosts",
        "allowedMediaTypes",
        "maximumAssets",
        "maximumBytes",
        "maximumBytesPerAsset",
        "maximumWidth",
        "maximumHeight",
        "minimumInterRequestDelayMs",
        "maximumInterRequestDelayMs",
        "maximumConcurrency",
        "maximumAttempts",
        "minimumRetryDelayMs",
        "maximumRetryDelayMs"
      ],
      "properties": {
        "allowedImageHosts": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "format": "hostname",
            "pattern": "^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$"
          },
          "uniqueItems": true
        },
        "allowedMediaTypes": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "enum": [
              "image/jpeg",
              "image/png",
              "image/webp",
              "image/avif",
              "image/gif"
            ]
          },
          "uniqueItems": true
        },
        "maximumAssets": {
          "type": "integer",
          "minimum": 1
        },
        "maximumBytes": {
          "type": "integer",
          "minimum": 1
        },
        "maximumBytesPerAsset": {
          "type": "integer",
          "minimum": 1
        },
        "maximumWidth": {
          "type": "integer",
          "minimum": 1
        },
        "maximumHeight": {
          "type": "integer",
          "minimum": 1
        },
        "minimumInterRequestDelayMs": {
          "type": "integer",
          "minimum": 1
        },
        "maximumInterRequestDelayMs": {
          "type": "integer",
          "minimum": 1
        },
        "maximumConcurrency": {
          "type": "integer",
          "minimum": 2,
          "maximum": 4
        },
        "maximumAttempts": {
          "type": "integer",
          "minimum": 1,
          "maximum": 3
        },
        "minimumRetryDelayMs": {
          "type": "integer",
          "minimum": 1
        },
        "maximumRetryDelayMs": {
          "type": "integer",
          "minimum": 1
        }
      }
    },
    "entityReference": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "recordType",
        "recordKey",
        "role"
      ],
      "properties": {
        "recordType": {
          "type": "string",
          "enum": [
            "pledge",
            "buyback",
            "containedItem",
            "profile",
            "organization",
            "organizationMember",
            "referral",
            "subscription"
          ]
        },
        "recordKey": {
          "type": "string",
          "minLength": 1
        },
        "role": {
          "type": "string",
          "minLength": 1
        }
      }
    },
    "asset": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "assetId",
        "sourceImageKeys",
        "sourceUrl",
        "finalUrl",
        "status",
        "relativePath",
        "mediaType",
        "byteLength",
        "pixelWidth",
        "pixelHeight",
        "contentHash",
        "fetchedAt",
        "attempts",
        "errorCode",
        "entityReferences"
      ],
      "allOf": [
        {
          "if": {
            "properties": {
              "status": {
                "enum": [
                  "downloaded",
                  "reused"
                ]
              }
            }
          },
          "then": {
            "properties": {
              "finalUrl": {
                "type": "string",
                "format": "uri",
                "pattern": "^https://"
              },
              "relativePath": {
                "$ref": "#/$defs/safeRelativePath"
              },
              "mediaType": {
                "type": "string",
                "enum": [
                  "image/jpeg",
                  "image/png",
                  "image/webp",
                  "image/avif",
                  "image/gif"
                ]
              },
              "byteLength": {
                "type": "integer",
                "minimum": 1
              },
              "pixelWidth": {
                "type": "integer",
                "minimum": 1
              },
              "pixelHeight": {
                "type": "integer",
                "minimum": 1
              },
              "contentHash": {
                "$ref": "#/$defs/sha256"
              },
              "fetchedAt": {
                "$ref": "#/$defs/dateTime"
              },
              "errorCode": {
                "type": "null"
              }
            }
          }
        },
        {
          "if": {
            "properties": {
              "status": {
                "enum": [
                  "missing",
                  "blocked",
                  "failed"
                ]
              }
            }
          },
          "then": {
            "properties": {
              "relativePath": {
                "type": "null"
              },
              "mediaType": {
                "type": "null"
              },
              "byteLength": {
                "type": "null"
              },
              "pixelWidth": {
                "type": "null"
              },
              "pixelHeight": {
                "type": "null"
              },
              "contentHash": {
                "type": "null"
              },
              "fetchedAt": {
                "type": "null"
              },
              "errorCode": {
                "type": "string",
                "minLength": 1
              }
            }
          }
        },
        {
          "if": {
            "properties": {
              "status": {
                "const": "skipped"
              }
            }
          },
          "then": {
            "properties": {
              "relativePath": {
                "type": "null"
              },
              "mediaType": {
                "type": "null"
              },
              "byteLength": {
                "type": "null"
              },
              "pixelWidth": {
                "type": "null"
              },
              "pixelHeight": {
                "type": "null"
              },
              "contentHash": {
                "type": "null"
              },
              "fetchedAt": {
                "type": "null"
              }
            }
          }
        }
      ],
      "properties": {
        "assetId": {
          "$ref": "#/$defs/sha256"
        },
        "sourceImageKeys": {
          "description": "Canonical account image keys that resolve to this fetched asset after public URL normalization.",
          "type": "array",
          "minItems": 1,
          "uniqueItems": true,
          "items": {
            "$ref": "#/$defs/sha256"
          }
        },
        "sourceUrl": {
          "type": "string",
          "format": "uri",
          "pattern": "^https://"
        },
        "finalUrl": {
          "oneOf": [
            {
              "type": "string",
              "format": "uri",
              "pattern": "^https://"
            },
            {
              "type": "null"
            }
          ]
        },
        "status": {
          "type": "string",
          "enum": [
            "downloaded",
            "reused",
            "missing",
            "blocked",
            "failed",
            "skipped"
          ]
        },
        "relativePath": {
          "oneOf": [
            {
              "$ref": "#/$defs/safeRelativePath"
            },
            {
              "type": "null"
            }
          ]
        },
        "displayFileName": {
          "description": "Optional human-facing alias derived from the adjacent entity title. Canonical storage remains content-addressed by assetId and relativePath.",
          "type": [
            "string",
            "null"
          ],
          "minLength": 1,
          "maxLength": 160,
          "pattern": "^[^/\\\\]+$"
        },
        "mediaType": {
          "$ref": "#/$defs/nullableString"
        },
        "byteLength": {
          "$ref": "#/$defs/nullableInteger"
        },
        "pixelWidth": {
          "$ref": "#/$defs/nullableInteger"
        },
        "pixelHeight": {
          "$ref": "#/$defs/nullableInteger"
        },
        "contentHash": {
          "oneOf": [
            {
              "$ref": "#/$defs/sha256"
            },
            {
              "type": "null"
            }
          ]
        },
        "fetchedAt": {
          "$ref": "#/$defs/nullableDateTime"
        },
        "attempts": {
          "type": "integer",
          "minimum": 0
        },
        "errorCode": {
          "$ref": "#/$defs/nullableString"
        },
        "entityReferences": {
          "type": "array",
          "minItems": 1,
          "items": {
            "$ref": "#/$defs/entityReference"
          }
        }
      }
    },
    "summary": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "desiredAssets",
        "downloaded",
        "reused",
        "missing",
        "blocked",
        "failed",
        "skipped",
        "totalBytes"
      ],
      "properties": {
        "desiredAssets": {
          "type": "integer",
          "minimum": 0
        },
        "downloaded": {
          "type": "integer",
          "minimum": 0
        },
        "reused": {
          "type": "integer",
          "minimum": 0
        },
        "missing": {
          "type": "integer",
          "minimum": 0
        },
        "blocked": {
          "type": "integer",
          "minimum": 0
        },
        "failed": {
          "type": "integer",
          "minimum": 0
        },
        "skipped": {
          "type": "integer",
          "minimum": 0
        },
        "totalBytes": {
          "type": "integer",
          "minimum": 0
        }
      }
    },
    "materializationReceipt": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "status",
        "startedAt",
        "endedAt",
        "requestCount",
        "retryCount",
        "effectiveMinimumInterRequestDelayMs",
        "warnings",
        "promoted"
      ],
      "allOf": [
        {
          "if": {
            "properties": {
              "promoted": {
                "const": true
              }
            }
          },
          "then": {
            "properties": {
              "status": {
                "const": "complete"
              }
            }
          }
        },
        {
          "if": {
            "properties": {
              "status": {
                "enum": [
                  "partial",
                  "failed",
                  "cancelled"
                ]
              }
            }
          },
          "then": {
            "properties": {
              "promoted": {
                "const": false
              }
            }
          }
        }
      ],
      "properties": {
        "status": {
          "type": "string",
          "enum": [
            "complete",
            "partial",
            "failed",
            "cancelled"
          ]
        },
        "startedAt": {
          "$ref": "#/$defs/dateTime"
        },
        "endedAt": {
          "$ref": "#/$defs/dateTime"
        },
        "requestCount": {
          "type": "integer",
          "minimum": 0
        },
        "retryCount": {
          "type": "integer",
          "minimum": 0
        },
        "effectiveMinimumInterRequestDelayMs": {
          "type": "integer",
          "minimum": 1
        },
        "warnings": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "promoted": {
          "type": "boolean"
        },
        "pacing": {
          "$ref": "#/$defs/runPacing"
        },
        "paceHistory": {
          "type": "object",
          "additionalProperties": false,
          "description": "Where the image run's pace history came from, what it held before the run, the accepted response times the controller was given, and the history with this run, as one aggregate. Counts and response times of the image family only: no address, token, cookie, header value, response body, IP address or RSI message.",
          "required": [
            "source",
            "priorAggregate",
            "acceptedSamples",
            "aggregate"
          ],
          "properties": {
            "source": {
              "type": "string",
              "enum": [
                "extension",
                "package",
                "none"
              ]
            },
            "priorAggregate": {
              "anyOf": [
                {
                  "type": "null"
                },
                {
                  "type": "object",
                  "additionalProperties": false,
                  "required": [
                    "runs",
                    "acceptedRequests",
                    "refusedRequests",
                    "retriedRequests",
                    "slowSteps"
                  ],
                  "properties": {
                    "runs": {
                      "type": "integer",
                      "minimum": 0
                    },
                    "acceptedRequests": {
                      "type": "integer",
                      "minimum": 0
                    },
                    "refusedRequests": {
                      "type": "integer",
                      "minimum": 0
                    },
                    "retriedRequests": {
                      "type": "integer",
                      "minimum": 0
                    },
                    "slowSteps": {
                      "type": "integer",
                      "minimum": 0
                    }
                  }
                }
              ]
            },
            "acceptedSamples": {
              "type": "array",
              "maxItems": 100,
              "items": {
                "type": "integer",
                "minimum": 0,
                "maximum": 600000
              }
            },
            "aggregate": {
              "type": "object"
            }
          }
        }
      }
    },
    "fileReceipt": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "relativePath",
        "byteLength",
        "contentHash"
      ],
      "properties": {
        "relativePath": {
          "$ref": "#/$defs/safeRelativePath"
        },
        "byteLength": {
          "type": "integer",
          "minimum": 0
        },
        "contentHash": {
          "$ref": "#/$defs/sha256"
        }
      }
    },
    "integrity": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "algorithm",
        "contentHash"
      ],
      "properties": {
        "algorithm": {
          "const": "SHA-256"
        },
        "contentHash": {
          "$ref": "#/$defs/sha256",
          "description": "Lowercase SHA-256 hexadecimal of the UTF-8 RFC 8785 JSON Canonicalization Scheme bytes after removing only integrity.contentHash and retaining integrity.algorithm."
        }
      }
    },
    "runPacing": {
      "type": "object",
      "additionalProperties": false,
      "description": "The run's pacing summary: the controller and settings that paced it and what RSI answered, counted. No token, cookie, header value, response body, IP address or RSI message.",
      "required": [
        "controllerVersion",
        "settingsVersion",
        "settingsFingerprint",
        "startedFactor",
        "acceptedRequests",
        "refusedRequests",
        "retriedRequests",
        "slowSteps",
        "maximumFactor",
        "finalFactor",
        "signalCounts"
      ],
      "properties": {
        "controllerVersion": {
          "type": "integer",
          "minimum": 1
        },
        "settingsVersion": {
          "type": "integer",
          "minimum": 1
        },
        "settingsFingerprint": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "startedFactor": {
          "type": "number",
          "minimum": 1
        },
        "acceptedRequests": {
          "type": "integer",
          "minimum": 0
        },
        "refusedRequests": {
          "type": "integer",
          "minimum": 0
        },
        "retriedRequests": {
          "type": "integer",
          "minimum": 0
        },
        "slowSteps": {
          "type": "integer",
          "minimum": 0
        },
        "maximumFactor": {
          "type": "number",
          "minimum": 1
        },
        "finalFactor": {
          "type": "number",
          "minimum": 1
        },
        "signalCounts": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "section",
              "kind",
              "code",
              "httpStatus",
              "count"
            ],
            "properties": {
              "section": {
                "type": "string",
                "minLength": 1,
                "maxLength": 120
              },
              "kind": {
                "type": "string",
                "minLength": 1,
                "maxLength": 20
              },
              "code": {
                "type": "string",
                "pattern": "^[A-Z0-9_]{1,80}$"
              },
              "httpStatus": {
                "oneOf": [
                  {
                    "type": "integer",
                    "minimum": 100,
                    "maximum": 599
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "count": {
                "type": "integer",
                "minimum": 1
              }
            }
          }
        }
      }
    }
  }
};
