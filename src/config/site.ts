import { PUBLIC_ARTALK_ENABLED, PUBLIC_ARTALK_SERVER } from "astro:env/server";

const artalkServer = PUBLIC_ARTALK_SERVER?.trim() || "";
const artalkEnabled =
  PUBLIC_ARTALK_ENABLED === undefined
    ? Boolean(artalkServer)
    : PUBLIC_ARTALK_ENABLED;

const site = {
  // --- Site Metadata ---
  meta: {
    title: "James Littlewood",
    description:
      "Data Analyst building practical projects with Python, SQL, PostgreSQL, Docker, Tableau and modern analytics tools.",
    author: "James Littlewood",
    logo: "/logo.svg",
    ogImage: "/og-image.png",
    lang: "en",
  },

  // --- Navigation ---
  navigation: [
    { name: "Home", subtitle: "Index", href: "/" },
    { name: "CV", subtitle: "Resume", href: "/cv" },
    { name: "Projects", subtitle: "Work", href: "/projects" },
    { name: "Stack", subtitle: "Tools", href: "/tools" },
  ],

  // --- Social Links ---
  social: [
    {
      name: "GitHub",
      href: "https://github.com/jameslittlewood",
      icon: "mdi:github",
    },
    {
      name: "Email",
      href: "mailto:contact@jameslittlewood.net",
      icon: "mdi:email",
    },
  ],

  friendCard: {
    name: "James Littlewood",
    description:
      "Data Analyst building practical projects with Python, SQL, PostgreSQL, Docker and Tableau.",
    link: "https://jameslittlewood.net",
    avatar: "https://jameslittlewood.net/logo.svg",
  },

  // --- Homepage Hero ---
  hero: {
    greeting: "👋 Hi, I’m James",
    description:
      'I’m a <span class="font-medium text-foreground underline decoration-primary/30">Data Analyst</span> building practical projects with <span class="font-medium text-foreground underline decoration-primary/30">Python</span>, <span class="font-medium text-foreground underline decoration-primary/30">SQL</span>, <span class="font-medium text-foreground underline decoration-primary/30">PostgreSQL</span>, <span class="font-medium text-foreground underline decoration-primary/30">Docker</span> and <span class="font-medium text-foreground underline decoration-primary/30">Tableau</span>.',
    cards: [
      {
        icon: "mdi:database-search",
        label: "Focus",
        value: "Data analytics & Python development",
      },
      {
        icon: "mdi:location",
        label: "Location",
        value: "Reading, UK",
      },
    ],
  },

  // --- Footer ---
  footer: {
    copyright: "© 2026 James Littlewood",
    builtWith: "Built with Astro",
  },

  // --- Comments ---
  comments: {
    enabled: artalkEnabled,
    provider: "artalk" as const,
    artalk: {
      server: artalkServer,
    },
  },

  // --- Feature Toggles ---
  features: {
    search: true,
    rss: true,
    newPostDays: 7,
  },

  // --- Tools Page Data ---
  tools: [
    {
      name: "data analysis",
      items: [
        {
          name: "Microsoft Excel",
          link: "https://www.microsoft.com/microsoft-365/excel",
          icon: "mdi:microsoft-excel",
        },
        {
          name: "Google Sheets",
          link: "https://www.google.com/sheets/about/",
          icon: "mdi:google-spreadsheet",
        },
        {
          name: "SQL",
          icon: "mdi:database-search",
        },
        {
          name: "PostgreSQL",
          link: "https://www.postgresql.org",
          icon: "mdi:database",
        },
        {
          name: "Snowflake",
          link: "https://www.snowflake.com",
          icon: "mdi:snowflake",
        },
      ],
    },
    {
      name: "dashboards",
      items: [
        {
          name: "Tableau",
          link: "https://www.tableau.com",
          icon: "mdi:chart-box-outline",
        },
        {
          name: "Power BI",
          link: "https://powerbi.microsoft.com",
          icon: "mdi:chart-bar",
        },
        {
          name: "Plotly",
          link: "https://plotly.com",
          icon: "mdi:chart-line",
        },
      ],
    },
    {
      name: "development",
      items: [
        {
          name: "Python",
          link: "https://www.python.org",
          icon: "mdi:language-python",
        },
        {
          name: "VS Code",
          link: "https://code.visualstudio.com",
          icon: "mdi:microsoft-visual-studio-code",
        },
        {
          name: "Git",
          link: "https://git-scm.com",
          icon: "mdi:git",
        },
        {
          name: "GitHub",
          link: "https://github.com/jameslittlewood",
          icon: "mdi:github",
        },
        {
          name: "Terminal",
          icon: "mdi:terminal",
        },
      ],
    },
    {
      name: "infrastructure",
      items: [
        {
          name: "Docker",
          link: "https://www.docker.com",
          icon: "mdi:docker",
        },
        {
          name: "Ubuntu",
          link: "https://ubuntu.com",
          icon: "mdi:ubuntu",
        },
        {
          name: "Linux",
          link: "https://www.linux.org",
          icon: "mdi:linux",
        },
        {
          name: "Tailscale",
          link: "https://tailscale.com",
          icon: "mdi:vpn",
        },
        {
          name: "Cloudflare",
          link: "https://www.cloudflare.com",
          icon: "mdi:cloud",
        },
      ],
    },
  ],

  // --- UI Labels ---
  labels: {
    postsTitle: "Writing",
    postsDescription:
      "Notes on data analytics, Python, SQL, dashboards and technical learning.",
    projectsTitle: "Projects",
    projectsDescription:
      "Practical data, dashboard and development projects built while learning.",
    friendsTitle: "Links",
    friendsDescription: "Useful links and people around the web.",
    toolsTitle: "Stack",
    aboutTitle: "About",
    aboutDescription:
      "My background, experience, skills and current learning path.",
    backToPosts: "Back to posts",
    goHome: "Go Home",
    notFoundTitle: "Page not found",
    notFoundDescription:
      "The page you're looking for may have been removed or the link is broken.",
    endOfPost: "End of Post",
    tableOfContents: "Table of Contents",
    searchPlaceholder: "Search posts, projects, tags or commands...",
    searchNavigate: "Navigate",
    commentSuccess: "Comment submitted",
  },

  ogImage: "/og-image.png",
} as const;

export default site;