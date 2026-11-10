/**
 * The flagship R34 of lukas.sc as the API rendered it for a guest in German (seeded demo data, 2026-11-03), with the host
 * replaced. Tests derive their variants from it.
 */
import type { PublicMod, PublicVehicle } from '@/api/queries/vehicles';

export const R34: PublicVehicle = {
  "id": "01m6f7zv1vs5e2xw9a96cbqzyp",
  "public_id": "5TF974VJ",
  "slug": "nissan-skyline-gt-r-r34-5tf974vj",
  "status": "published",
  "visibility": "public",
  "is_main": true,
  "eyebrow": "NISSAN",
  "make": "Nissan",
  "model": "Skyline GT-R",
  "generation": "R34",
  "title": "Skyline GT-R R34",
  "full_title": "Nissan Skyline GT-R R34",
  "nickname": "Bayside",
  "color": "Bayside Blue",
  "model_year": 2002,
  "subline_parts": [
    "2002",
    "2,6 l R6 Biturbo (RB26DETT)",
    "Bayside Blue"
  ],
  "spec_strip": [
    {
      "key": "power",
      "value": "500",
      "unit": "PS",
      "label": "PS"
    },
    {
      "key": "torque",
      "value": "540",
      "unit": "Nm",
      "label": "Nm"
    },
    {
      "key": "model_year",
      "value": "2002",
      "unit": null,
      "label": "Baujahr"
    },
    {
      "key": "drivetrain",
      "value": "AWD",
      "unit": null,
      "label": "Antrieb"
    }
  ],
  "cover": {
    "id": "01m6f807bc8x62twbhd9r3hz9h",
    "status": "ready",
    "category": "exterior",
    "width": 1440,
    "height": 1920,
    "blurhash": "ToGb||x]jY_Nt7ayM{j?ofIUofjs",
    "focal_x": 0.54,
    "focal_y": 0.66,
    "alt": "Blauer Nissan Skyline GT-R R34 von hinten unter Gewitterwolken",
    "sort": 1,
    "variants": [
      {
        "width": 320,
        "height": 427,
        "url": "http://localhost:8080/storage/media/01m6f807bc8x62twbhd9r3hz9h/58495bd11e88cb4e-320.webp"
      },
      {
        "width": 640,
        "height": 853,
        "url": "http://localhost:8080/storage/media/01m6f807bc8x62twbhd9r3hz9h/13f1c01ec9bf474f-640.webp"
      },
      {
        "width": 1080,
        "height": 1440,
        "url": "http://localhost:8080/storage/media/01m6f807bc8x62twbhd9r3hz9h/67c17bd597d42d3b-1080.webp"
      },
      {
        "width": 1440,
        "height": 1920,
        "url": "http://localhost:8080/storage/media/01m6f807bc8x62twbhd9r3hz9h/10041620b78f898e-1440.webp"
      }
    ],
    "created_at": "2026-11-02T23:02:38+00:00"
  },
  "photo_count": 3,
  "mod_count": 14,
  "published_at": "2026-03-14T18:30:00+00:00",
  "updated_at": "2026-03-14T18:30:00+00:00",
  "wizard": null,
  "completeness": null,
  "qr": null,
  "canonical_url": "http://localhost:8080/v/nissan-skyline-gt-r-r34-5tf974vj",
  "description": "Skyline GT-R V-Spec II aus Japan, 2021 über Yokohama importiert und seitdem Schritt für Schritt aufgebaut. Der RB26 läuft mit GT-SS-Ladern und sauberer Abstimmung auf dem Prüfstand. Ziel: ein Auto, das man wirklich fährt.",
  "power": {
    "label": "500 PS (368 kW)",
    "value": 500,
    "unit": "ps",
    "ps": 500,
    "source": "measured",
    "source_label": "Gemessen"
  },
  "torque": {
    "label": "540 Nm",
    "nm": 540,
    "source": "measured",
    "source_label": "Gemessen"
  },
  "spec_groups": [
    {
      "key": "vehicle",
      "label": "Fahrzeug",
      "rows": [
        {
          "key": "make",
          "label": "Marke",
          "value": "Nissan",
          "source": null,
          "source_label": null
        },
        {
          "key": "model",
          "label": "Modell",
          "value": "Skyline GT-R",
          "source": null,
          "source_label": null
        },
        {
          "key": "generation",
          "label": "Generation",
          "value": "R34",
          "source": null,
          "source_label": null
        },
        {
          "key": "model_year",
          "label": "Baujahr",
          "value": "2002",
          "source": null,
          "source_label": null
        },
        {
          "key": "color",
          "label": "Farbe",
          "value": "Bayside Blue",
          "source": null,
          "source_label": null
        }
      ]
    },
    {
      "key": "engine",
      "label": "Motor",
      "rows": [
        {
          "key": "engine_text",
          "label": "Motor",
          "value": "2,6 l R6 Biturbo",
          "source": null,
          "source_label": null
        },
        {
          "key": "engine_code",
          "label": "Motorcode",
          "value": "RB26DETT",
          "source": null,
          "source_label": null
        },
        {
          "key": "displacement_cc",
          "label": "Hubraum",
          "value": "2.568 cm³",
          "source": null,
          "source_label": null
        },
        {
          "key": "fuel",
          "label": "Kraftstoff",
          "value": "Benzin",
          "source": null,
          "source_label": null
        },
        {
          "key": "aspiration",
          "label": "Aufladung",
          "value": "Biturbo",
          "source": null,
          "source_label": null
        }
      ]
    },
    {
      "key": "power",
      "label": "Leistung",
      "rows": [
        {
          "key": "power",
          "label": "Leistung",
          "value": "500 PS (368 kW)",
          "source": "measured",
          "source_label": "Gemessen"
        },
        {
          "key": "torque",
          "label": "Drehmoment",
          "value": "540 Nm",
          "source": "measured",
          "source_label": "Gemessen"
        }
      ]
    },
    {
      "key": "drivetrain",
      "label": "Antrieb",
      "rows": [
        {
          "key": "drivetrain",
          "label": "Antrieb",
          "value": "Allrad",
          "source": null,
          "source_label": null
        },
        {
          "key": "gearbox",
          "label": "Getriebe",
          "value": "Schaltgetriebe",
          "source": null,
          "source_label": null
        }
      ]
    }
  ],
  "photos": [
    {
      "id": "01m6f807bc8x62twbhd9r3hz9h",
      "status": "ready",
      "category": "exterior",
      "width": 1440,
      "height": 1920,
      "blurhash": "ToGb||x]jY_Nt7ayM{j?ofIUofjs",
      "focal_x": 0.54,
      "focal_y": 0.66,
      "alt": "Blauer Nissan Skyline GT-R R34 von hinten unter Gewitterwolken",
      "sort": 1,
      "variants": [
        {
          "width": 320,
          "height": 427,
          "url": "http://localhost:8080/storage/media/01m6f807bc8x62twbhd9r3hz9h/58495bd11e88cb4e-320.webp"
        },
        {
          "width": 640,
          "height": 853,
          "url": "http://localhost:8080/storage/media/01m6f807bc8x62twbhd9r3hz9h/13f1c01ec9bf474f-640.webp"
        },
        {
          "width": 1080,
          "height": 1440,
          "url": "http://localhost:8080/storage/media/01m6f807bc8x62twbhd9r3hz9h/67c17bd597d42d3b-1080.webp"
        },
        {
          "width": 1440,
          "height": 1920,
          "url": "http://localhost:8080/storage/media/01m6f807bc8x62twbhd9r3hz9h/10041620b78f898e-1440.webp"
        }
      ],
      "created_at": "2026-11-02T23:02:38+00:00"
    },
    {
      "id": "01m6fem2gj4w3e89t7csht0hpt",
      "status": "ready",
      "category": "interior",
      "width": 1280,
      "height": 1920,
      "blurhash": "TWAn7Mt7M{_Mt7RP%ftQRjayt7af",
      "focal_x": 0.45,
      "focal_y": 0.61,
      "alt": "Tiefes Sportlenkrad vor rot leuchtenden Instrumenten",
      "sort": 2,
      "variants": [
        {
          "width": 320,
          "height": 480,
          "url": "http://localhost:8080/storage/media/01m6fem2gj4w3e89t7csht0hpt/1f829f1f809375f6-320.webp"
        },
        {
          "width": 640,
          "height": 960,
          "url": "http://localhost:8080/storage/media/01m6fem2gj4w3e89t7csht0hpt/a85eb171b729b387-640.webp"
        },
        {
          "width": 1080,
          "height": 1620,
          "url": "http://localhost:8080/storage/media/01m6fem2gj4w3e89t7csht0hpt/6b97af2941e382f8-1080.webp"
        },
        {
          "width": 1280,
          "height": 1920,
          "url": "http://localhost:8080/storage/media/01m6fem2gj4w3e89t7csht0hpt/463780b5b8454981-1280.webp"
        }
      ],
      "created_at": "2026-11-03T00:58:20+00:00"
    },
    {
      "id": "01m6fem4vxapj3sstfjbpg334d",
      "status": "ready",
      "category": "engine",
      "width": 1920,
      "height": 1280,
      "blurhash": "L6Ad4NOr?uxtXm-:x]-:tl_M?b?a",
      "focal_x": 0.5,
      "focal_y": 0.55,
      "alt": "Aufwendig getunter Motorraum mit Carbon-Ansaugbrücke",
      "sort": 3,
      "variants": [
        {
          "width": 320,
          "height": 213,
          "url": "http://localhost:8080/storage/media/01m6fem4vxapj3sstfjbpg334d/36202461ee60db86-320.webp"
        },
        {
          "width": 640,
          "height": 427,
          "url": "http://localhost:8080/storage/media/01m6fem4vxapj3sstfjbpg334d/d36ee20d43104a6d-640.webp"
        },
        {
          "width": 1080,
          "height": 720,
          "url": "http://localhost:8080/storage/media/01m6fem4vxapj3sstfjbpg334d/c63eeaef818e305a-1080.webp"
        },
        {
          "width": 1600,
          "height": 1067,
          "url": "http://localhost:8080/storage/media/01m6fem4vxapj3sstfjbpg334d/4c142029503a002a-1600.webp"
        }
      ],
      "created_at": "2026-11-03T00:58:22+00:00"
    }
  ],
  "highlights": [
    {
      "id": "01m6f7zv69mmmre4xrm2nn1tcw",
      "title": "Rays Volk Racing TE37 Saga",
      "category": {
        "key": "wheels_tires",
        "name": "Räder & Reifen",
        "icon": "wheel"
      },
      "brand": "Rays",
      "summary_line": "Rays Volk Racing TE37 Saga · 18″ × 9,5J ET22 · 265/35 R18",
      "status": "installed",
      "status_label": "Verbaut",
      "installed_on": "2022-05",
      "installed_label": "Mai 2022",
      "cost_public": false,
      "cost": null,
      "legal_status": "unknown",
      "legal_status_label": "Unbekannt",
      "thumb": null
    },
    {
      "id": "01m6f7zv8p20aegc91c91pa94a",
      "title": "KW V3",
      "category": {
        "key": "suspension",
        "name": "Fahrwerk",
        "icon": "coilover"
      },
      "brand": "KW",
      "summary_line": "KW V3 · −35 mm",
      "status": "installed",
      "status_label": "Verbaut",
      "installed_on": "2022-03",
      "installed_label": "März 2022",
      "cost_public": false,
      "cost": null,
      "legal_status": "parts_certificate",
      "legal_status_label": "Teilegutachten",
      "thumb": null
    },
    {
      "id": "01m6f7zv9g5n8phxvmj4r2zzqj",
      "title": "HKS Super Turbo Muffler",
      "category": {
        "key": "exhaust",
        "name": "Abgasanlage",
        "icon": "exhaust"
      },
      "brand": "HKS",
      "summary_line": "HKS Super Turbo Muffler",
      "status": "installed",
      "status_label": "Verbaut",
      "installed_on": "2023-02",
      "installed_label": "Februar 2023",
      "cost_public": false,
      "cost": null,
      "legal_status": "unknown",
      "legal_status_label": "Unbekannt",
      "thumb": null
    }
  ],
  "mods": {
    "count": 14,
    "groups": [
      {
        "category": {
          "key": "wheels_tires",
          "name": "Räder & Reifen",
          "icon": "wheel"
        },
        "count": 1,
        "items": [
          {
            "id": "01m6f7zv69mmmre4xrm2nn1tcw",
            "title": "Rays Volk Racing TE37 Saga",
            "category": {
              "key": "wheels_tires",
              "name": "Räder & Reifen",
              "icon": "wheel"
            },
            "brand": "Rays",
            "summary_line": "Rays Volk Racing TE37 Saga · 18″ × 9,5J ET22 · 265/35 R18",
            "status": "installed",
            "status_label": "Verbaut",
            "installed_on": "2022-05",
            "installed_label": "Mai 2022",
            "cost_public": false,
            "cost": null,
            "legal_status": "unknown",
            "legal_status_label": "Unbekannt",
            "thumb": null
          }
        ]
      },
      {
        "category": {
          "key": "suspension",
          "name": "Fahrwerk",
          "icon": "coilover"
        },
        "count": 1,
        "items": [
          {
            "id": "01m6f7zv8p20aegc91c91pa94a",
            "title": "KW V3",
            "category": {
              "key": "suspension",
              "name": "Fahrwerk",
              "icon": "coilover"
            },
            "brand": "KW",
            "summary_line": "KW V3 · −35 mm",
            "status": "installed",
            "status_label": "Verbaut",
            "installed_on": "2022-03",
            "installed_label": "März 2022",
            "cost_public": false,
            "cost": null,
            "legal_status": "parts_certificate",
            "legal_status_label": "Teilegutachten",
            "thumb": null
          }
        ]
      },
      {
        "category": {
          "key": "exhaust",
          "name": "Abgasanlage",
          "icon": "exhaust"
        },
        "count": 3,
        "items": [
          {
            "id": "01m6f7zv9g5n8phxvmj4r2zzqj",
            "title": "HKS Super Turbo Muffler",
            "category": {
              "key": "exhaust",
              "name": "Abgasanlage",
              "icon": "exhaust"
            },
            "brand": "HKS",
            "summary_line": "HKS Super Turbo Muffler",
            "status": "installed",
            "status_label": "Verbaut",
            "installed_on": "2023-02",
            "installed_label": "Februar 2023",
            "cost_public": false,
            "cost": null,
            "legal_status": "unknown",
            "legal_status_label": "Unbekannt",
            "thumb": null
          },
          {
            "id": "01m6f7zvaamz0p0s3kk23tgrvk",
            "title": "Fujitsubo Legalis R",
            "category": {
              "key": "exhaust",
              "name": "Abgasanlage",
              "icon": "exhaust"
            },
            "brand": "Fujitsubo",
            "summary_line": "Fujitsubo Legalis R",
            "status": "removed",
            "status_label": "Entfernt",
            "installed_on": "2021-09",
            "installed_label": "September 2021",
            "cost_public": false,
            "cost": null,
            "legal_status": "unknown",
            "legal_status_label": "Unbekannt",
            "thumb": null
          },
          {
            "id": "01m6f7zvb011rvdkqckz8ngf15",
            "title": "Tomei Expreme Ti",
            "category": {
              "key": "exhaust",
              "name": "Abgasanlage",
              "icon": "exhaust"
            },
            "brand": "Tomei",
            "summary_line": "Tomei Expreme Ti",
            "status": "planned",
            "status_label": "Geplant",
            "installed_on": null,
            "installed_label": null,
            "cost_public": false,
            "cost": null,
            "legal_status": "unknown",
            "legal_status_label": "Unbekannt",
            "thumb": null
          }
        ]
      },
      {
        "category": {
          "key": "engine_performance",
          "name": "Motor & Leistung",
          "icon": "turbo"
        },
        "count": 1,
        "items": [
          {
            "id": "01m6f7zvbrsmmm6ee0vygevxtx",
            "title": "HKS GT-SS Twin Turbo",
            "category": {
              "key": "engine_performance",
              "name": "Motor & Leistung",
              "icon": "turbo"
            },
            "brand": "HKS",
            "summary_line": "HKS GT-SS Twin Turbo · 500 PS",
            "status": "installed",
            "status_label": "Verbaut",
            "installed_on": "2024-04",
            "installed_label": "April 2024",
            "cost_public": false,
            "cost": null,
            "legal_status": "individual_approval",
            "legal_status_label": "Einzelabnahme",
            "thumb": null
          }
        ]
      },
      {
        "category": {
          "key": "brakes",
          "name": "Bremsen",
          "icon": "brake-disc"
        },
        "count": 1,
        "items": [
          {
            "id": "01m6f7zvcjc01nazek6esxcmat",
            "title": "AP Racing Radi-CAL",
            "category": {
              "key": "brakes",
              "name": "Bremsen",
              "icon": "brake-disc"
            },
            "brand": "AP Racing",
            "summary_line": "AP Racing Radi-CAL · 356 mm",
            "status": "installed",
            "status_label": "Verbaut",
            "installed_on": "2024-09",
            "installed_label": "September 2024",
            "cost_public": false,
            "cost": null,
            "legal_status": "parts_certificate",
            "legal_status_label": "Teilegutachten",
            "thumb": null
          }
        ]
      },
      {
        "category": {
          "key": "aero_body",
          "name": "Aero & Karosserie",
          "icon": "wing"
        },
        "count": 2,
        "items": [
          {
            "id": "01m6f7zvdbet5nbyfamp81pfex",
            "title": "Nismo Aero-Seitenschweller",
            "category": {
              "key": "aero_body",
              "name": "Aero & Karosserie",
              "icon": "wing"
            },
            "brand": "Nismo",
            "summary_line": "Nismo Aero-Seitenschweller",
            "status": "installed",
            "status_label": "Verbaut",
            "installed_on": "2023-07",
            "installed_label": "Juli 2023",
            "cost_public": false,
            "cost": null,
            "legal_status": "not_required",
            "legal_status_label": "Nicht erforderlich",
            "thumb": null
          },
          {
            "id": "01m6f7zvecmq97whxekqr678x2",
            "title": "Seibon Carbon-Kofferraumdeckel OEM-Style",
            "category": {
              "key": "aero_body",
              "name": "Aero & Karosserie",
              "icon": "wing"
            },
            "brand": "Seibon",
            "summary_line": "Seibon Carbon-Kofferraumdeckel OEM-Style",
            "status": "installed",
            "status_label": "Verbaut",
            "installed_on": "2025-03",
            "installed_label": "März 2025",
            "cost_public": false,
            "cost": null,
            "legal_status": "not_required",
            "legal_status_label": "Nicht erforderlich",
            "thumb": null
          }
        ]
      },
      {
        "category": {
          "key": "interior",
          "name": "Innenraum",
          "icon": "seat"
        },
        "count": 2,
        "items": [
          {
            "id": "01m6f7zvfm702ppc979dzmeyt2",
            "title": "Bride Zeta III",
            "category": {
              "key": "interior",
              "name": "Innenraum",
              "icon": "seat"
            },
            "brand": "Bride",
            "summary_line": "Bride Zeta III",
            "status": "installed",
            "status_label": "Verbaut",
            "installed_on": "2023-11",
            "installed_label": "November 2023",
            "cost_public": false,
            "cost": null,
            "legal_status": "parts_certificate",
            "legal_status_label": "Teilegutachten",
            "thumb": null
          },
          {
            "id": "01m6f7zvgc39sj60009m9hbx18",
            "title": "Nardi Classic 330",
            "category": {
              "key": "interior",
              "name": "Innenraum",
              "icon": "seat"
            },
            "brand": "Nardi",
            "summary_line": "Nardi Classic 330",
            "status": "installed",
            "status_label": "Verbaut",
            "installed_on": "2022-08",
            "installed_label": "August 2022",
            "cost_public": false,
            "cost": null,
            "legal_status": "unknown",
            "legal_status_label": "Unbekannt",
            "thumb": null
          }
        ]
      },
      {
        "category": {
          "key": "electronics",
          "name": "Elektronik & Licht",
          "icon": "light"
        },
        "count": 2,
        "items": [
          {
            "id": "01m6f7zvh6f4rdxvfr5r3xfmr1",
            "title": "Defi Advance BF",
            "category": {
              "key": "electronics",
              "name": "Elektronik & Licht",
              "icon": "light"
            },
            "brand": "Defi",
            "summary_line": "Defi Advance BF",
            "status": "installed",
            "status_label": "Verbaut",
            "installed_on": "2023-01",
            "installed_label": "Januar 2023",
            "cost_public": false,
            "cost": null,
            "legal_status": "not_required",
            "legal_status_label": "Nicht erforderlich",
            "thumb": null
          },
          {
            "id": "01m6f7zvjzrrawwy5f2pna8ys9",
            "title": "HKS EVC 7",
            "category": {
              "key": "electronics",
              "name": "Elektronik & Licht",
              "icon": "light"
            },
            "brand": "HKS",
            "summary_line": "HKS EVC 7",
            "status": "installed",
            "status_label": "Verbaut",
            "installed_on": "2024-04",
            "installed_label": "April 2024",
            "cost_public": false,
            "cost": null,
            "legal_status": "unknown",
            "legal_status_label": "Unbekannt",
            "thumb": null
          }
        ]
      },
      {
        "category": {
          "key": "drivetrain",
          "name": "Antrieb & Getriebe",
          "icon": "gearbox"
        },
        "count": 1,
        "items": [
          {
            "id": "01m6f7zvhxte1p5gdw1cn8r21c",
            "title": "Exedy Hyper Multi",
            "category": {
              "key": "drivetrain",
              "name": "Antrieb & Getriebe",
              "icon": "gearbox"
            },
            "brand": "Exedy",
            "summary_line": "Exedy Hyper Multi",
            "status": "installed",
            "status_label": "Verbaut",
            "installed_on": "2024-04",
            "installed_label": "April 2024",
            "cost_public": false,
            "cost": null,
            "legal_status": "not_required",
            "legal_status_label": "Nicht erforderlich",
            "thumb": null
          }
        ]
      }
    ]
  },
  "updates_count": 7,
  "updates": [
    {
      "id": "01m6f7zvkamnztfmw6a5cgh15f",
      "type": "note",
      "type_label": "Notiz",
      "note": "Saisonstart: Öl, Kerzen und Bremsflüssigkeit neu. Läuft wie am ersten Tag.",
      "summary": "Saisonstart: Öl, Kerzen und Bremsflüssigkeit neu. Läuft wie am ersten Tag.",
      "changes": [],
      "changes_count": 0,
      "hidden": false,
      "created_at": "2026-05-10T20:15:00+00:00",
      "month_label": "Mai 2026"
    },
    {
      "id": "01m6f7zvcwrtkg3g94hhf8gw34",
      "type": "mod_added",
      "type_label": "Modifikation hinzugefügt",
      "note": null,
      "summary": "Bremsen: Brembo Serie → AP Racing Radi-CAL · 356 mm",
      "changes": [
        {
          "kind": "mod_added",
          "category": "brakes",
          "modification_id": "01m6f7zvcjc01nazek6esxcmat",
          "label": "Bremsen",
          "before": "Brembo Serie",
          "after": "AP Racing Radi-CAL · 356 mm",
          "text": "Bremsen: Brembo Serie → AP Racing Radi-CAL · 356 mm",
          "details": []
        }
      ],
      "changes_count": 1,
      "hidden": false,
      "created_at": "2024-09-03T19:00:00+00:00",
      "month_label": "September 2024"
    },
    {
      "id": "01m6f7zvj8xs0qxevp48wn44s4",
      "type": "mod_added",
      "type_label": "Modifikation hinzugefügt",
      "note": null,
      "summary": "Kupplung: Serie → Exedy Hyper Multi",
      "changes": [
        {
          "kind": "mod_added",
          "category": "drivetrain",
          "modification_id": "01m6f7zvhxte1p5gdw1cn8r21c",
          "label": "Kupplung",
          "before": "Serie",
          "after": "Exedy Hyper Multi",
          "text": "Kupplung: Serie → Exedy Hyper Multi",
          "details": []
        }
      ],
      "changes_count": 1,
      "hidden": false,
      "created_at": "2024-04-03T19:00:00+00:00",
      "month_label": "April 2024"
    },
    {
      "id": "01m6f7zvc1r7gdrqv4cmb6zmwt",
      "type": "mod_added",
      "type_label": "Modifikation hinzugefügt",
      "note": null,
      "summary": "Leistung: 280 PS → 500 PS · gemessen",
      "changes": [
        {
          "kind": "mod_added",
          "category": "engine_performance",
          "modification_id": "01m6f7zvbrsmmm6ee0vygevxtx",
          "label": "Leistung",
          "before": "280 PS",
          "after": "500 PS · gemessen",
          "text": "Leistung: 280 PS → 500 PS · gemessen",
          "details": []
        }
      ],
      "changes_count": 1,
      "hidden": false,
      "created_at": "2024-04-03T19:00:00+00:00",
      "month_label": "April 2024"
    },
    {
      "id": "01m6f7zv9s3b45ns4xh8cxhhqm",
      "type": "mod_added",
      "type_label": "Modifikation hinzugefügt",
      "note": null,
      "summary": "Abgasanlage: Fujitsubo Legalis R → HKS Super Turbo Muffler",
      "changes": [
        {
          "kind": "mod_added",
          "category": "exhaust",
          "modification_id": "01m6f7zv9g5n8phxvmj4r2zzqj",
          "label": "Abgasanlage",
          "before": "Fujitsubo Legalis R",
          "after": "HKS Super Turbo Muffler",
          "text": "Abgasanlage: Fujitsubo Legalis R → HKS Super Turbo Muffler",
          "details": []
        }
      ],
      "changes_count": 1,
      "hidden": false,
      "created_at": "2023-03-13T10:00:00+00:00",
      "month_label": "März 2023"
    },
    {
      "id": "01m6f7zv90erynn1b80t2r1pja",
      "type": "mod_added",
      "type_label": "Modifikation hinzugefügt",
      "note": null,
      "summary": "Fahrwerk: Serie → KW V3 · −35 mm",
      "changes": [
        {
          "kind": "mod_added",
          "category": "suspension",
          "modification_id": "01m6f7zv8p20aegc91c91pa94a",
          "label": "Fahrwerk",
          "before": "Serie",
          "after": "KW V3 · −35 mm",
          "text": "Fahrwerk: Serie → KW V3 · −35 mm",
          "details": []
        }
      ],
      "changes_count": 1,
      "hidden": false,
      "created_at": "2023-03-13T10:00:00+00:00",
      "month_label": "März 2023"
    },
    {
      "id": "01m6f7zv80z8dt0ghf8sthntwa",
      "type": "mod_added",
      "type_label": "Modifikation hinzugefügt",
      "note": null,
      "summary": "Räder: Serie 18″ → Volk Racing TE37 Saga 18″ × 9,5J ET22",
      "changes": [
        {
          "kind": "mod_added",
          "category": "wheels_tires",
          "modification_id": "01m6f7zv69mmmre4xrm2nn1tcw",
          "label": "Räder",
          "before": "Serie 18″",
          "after": "Volk Racing TE37 Saga 18″ × 9,5J ET22",
          "text": "Räder: Serie 18″ → Volk Racing TE37 Saga 18″ × 9,5J ET22",
          "details": []
        }
      ],
      "changes_count": 1,
      "hidden": false,
      "created_at": "2023-03-13T10:00:00+00:00",
      "month_label": "März 2023"
    }
  ],
  "owner": {
    "username": "lukas.sc",
    "display_name": "Lukas Scholz",
    "city": "Stuttgart",
    "bio": "KFZ-Mechatroniker aus Stuttgart. Der R34 war zehn Jahre ein Traum, seit 2021 steht er in der Garage. Schraube fast alles selbst.",
    "avatar": null,
    "cover": {
      "id": "01m6f807bc8x62twbhd9r3hz9h",
      "status": "ready",
      "category": "exterior",
      "width": 1440,
      "height": 1920,
      "blurhash": "ToGb||x]jY_Nt7ayM{j?ofIUofjs",
      "focal_x": 0.54,
      "focal_y": 0.66,
      "alt": "Blauer Nissan Skyline GT-R R34 von hinten unter Gewitterwolken",
      "sort": 1,
      "variants": [
        {
          "width": 320,
          "height": 427,
          "url": "http://localhost:8080/storage/media/01m6f807bc8x62twbhd9r3hz9h/58495bd11e88cb4e-320.webp"
        },
        {
          "width": 640,
          "height": 853,
          "url": "http://localhost:8080/storage/media/01m6f807bc8x62twbhd9r3hz9h/13f1c01ec9bf474f-640.webp"
        },
        {
          "width": 1080,
          "height": 1440,
          "url": "http://localhost:8080/storage/media/01m6f807bc8x62twbhd9r3hz9h/67c17bd597d42d3b-1080.webp"
        },
        {
          "width": 1440,
          "height": 1920,
          "url": "http://localhost:8080/storage/media/01m6f807bc8x62twbhd9r3hz9h/10041620b78f898e-1440.webp"
        }
      ],
      "created_at": "2026-11-02T23:02:38+00:00"
    },
    "member_since": "2023-03-12T10:00:00+00:00",
    "stats": {
      "vehicles": 2,
      "followers": 5,
      "following": 3
    },
    "is_self": false,
    "is_following": false,
    "follows_you": false,
    "can_message": true
  },
  "share_card_url": null,
  "is_owner": false,
  "is_saved": null
};

export const R34_WHEELS: PublicMod = {
  "id": "01m6f7zv69mmmre4xrm2nn1tcw",
  "title": "Rays Volk Racing TE37 Saga",
  "category": {
    "key": "wheels_tires",
    "name": "Räder & Reifen",
    "icon": "wheel"
  },
  "brand": "Rays",
  "summary_line": "Rays Volk Racing TE37 Saga · 18″ × 9,5J ET22 · 265/35 R18",
  "status": "installed",
  "status_label": "Verbaut",
  "installed_on": "2022-05",
  "installed_label": "Mai 2022",
  "cost_public": false,
  "cost": null,
  "legal_status": "unknown",
  "legal_status_label": "Unbekannt",
  "thumb": null,
  "vehicle_id": "01m6f7zv1vs5e2xw9a96cbqzyp",
  "brand_id": 5,
  "brand_text": null,
  "part_name": "Volk Racing TE37 Saga",
  "part_number": null,
  "notes": null,
  "sort": 1,
  "specs": [
    {
      "key": "wheel_brand",
      "label": "Felgenmarke",
      "value": "Rays"
    },
    {
      "key": "wheel_model",
      "label": "Felgenmodell",
      "value": "Volk Racing TE37 Saga"
    },
    {
      "key": "diameter",
      "label": "Durchmesser",
      "value": "18″"
    },
    {
      "key": "width_front",
      "label": "Breite vorne",
      "value": "9,5J"
    },
    {
      "key": "width_rear",
      "label": "Breite hinten",
      "value": "9,5J"
    },
    {
      "key": "et_front",
      "label": "ET vorne",
      "value": "ET22"
    },
    {
      "key": "et_rear",
      "label": "ET hinten",
      "value": "ET22"
    },
    {
      "key": "bolt_pattern",
      "label": "Lochkreis",
      "value": "5×114,3"
    },
    {
      "key": "finish",
      "label": "Finish/Farbe",
      "value": "Schwarz"
    },
    {
      "key": "staggered",
      "label": "Mischbereifung",
      "value": "Nein"
    },
    {
      "key": "tyre_brand",
      "label": "Reifenmarke",
      "value": "Michelin"
    },
    {
      "key": "tyre_model",
      "label": "Reifenmodell",
      "value": "Pilot Sport 4 S"
    },
    {
      "key": "tyre_size_front",
      "label": "Reifengröße vorne",
      "value": "265/35 R18"
    },
    {
      "key": "tyre_size_rear",
      "label": "Reifengröße hinten",
      "value": "265/35 R18"
    }
  ],
  "fields": null,
  "legal_disclaimer": "Angaben des Besitzers, keine rechtliche Prüfung",
  "search": {
    "mod_category": "wheels_tires",
    "wheel_brand": "rays",
    "wheel_diameter": 18,
    "suspension_type": null,
    "suspension_brand": null,
    "exhaust_brand": null
  },
  "photos": [],
  "failed_photos": []
};
