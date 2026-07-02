export const YT = q => "https://www.youtube.com/results?search_query=" + encodeURIComponent(q);

export const THEMES = {
  Volt:  { work:"#c6f24e", rest:"#ffb13d", rotate:"#ff4d6d", prep:"#56d3ff" },
  Ember: { work:"#ff7a2e", rest:"#ffd23d", rotate:"#ff2e7a", prep:"#5fd0ff" },
  Ice:   { work:"#42e8ff", rest:"#8a8fff", rotate:"#ff5c8a", prep:"#bdfff0" },
  Mono:  { work:"#f1f1ea", rest:"#9aa0aa", rotate:"#ff5b5b", prep:"#6aa6ff" },
  Candy: { work:"#ff5cae", rest:"#ffe14d", rotate:"#a05cff", prep:"#4ce0ff" },
};

export const LADDERS = {
  "Descending": [[60,30],[50,25],[40,20],[30,15],[20,10]],
  "Ascending":  [[20,10],[30,15],[40,20],[50,25],[60,30]],
  "Pyramid":    [[20,10],[40,20],[60,30],[40,20],[20,10]],
  "Tabata":     [[20,10],[20,10],[20,10],[20,10],[20,10],[20,10],[20,10],[20,10]],
  "Flat 40/20": [[40,20],[40,20],[40,20],[40,20],[40,20]],
};

export const LENGTHS = [
  {label:"1 pass", min:0},{label:"15 min", min:15},{label:"20", min:20},
  {label:"30", min:30},{label:"45", min:45},{label:"60", min:60},
];

export const EXERCISES = [
  {ex:"KB Swing",         gear:"25 lb",      rep:"15 reps",       url:YT("kettlebell swing form technique")},
  {ex:"Goblet Squat",     gear:"15 lb",      rep:"15 reps",       url:YT("kettlebell goblet squat form")},
  {ex:"KB Clean & Press", gear:"25 lb",      rep:"10 · 5/arm", url:YT("kettlebell clean and press form")},
  {ex:"KB Deadlift",      gear:"25 lb",      rep:"12 reps",       url:YT("kettlebell deadlift form")},
  {ex:"KB Row",           gear:"25 lb",      rep:"10/arm",        url:YT("kettlebell bent over row form")},
  {ex:"Vest Squats",      gear:"Vest",       rep:"15 reps",       url:YT("bodyweight squat proper form")},
  {ex:"Walking Lunges",   gear:"Vest",       rep:"10/leg",        url:YT("walking lunge form")},
  {ex:"Push-ups",         gear:"Bodyweight", rep:"12–15 reps", url:YT("push up proper form")},
  {ex:"Mountain Climbers",gear:"Bodyweight", rep:"30 sec",        url:YT("mountain climbers form")},
  {ex:"Plank",            gear:"Vest",       rep:"Hold",          url:YT("forearm plank form")},
  {ex:"Plate G-to-OH",    gear:"10 lb",      rep:"12 reps",       url:YT("weight plate ground to overhead")},
  {ex:"Jump Rope",        gear:"Rope",       rep:"To time",       url:YT("jump rope basics beginners")},
];

export function howto(s){ return (s && s.url) ? s.url : YT(((s && s.ex) || "exercise") + " proper form"); }

export const DEFAULT = {
  people: 2, prep: 5,
  ladder: [[60,30],[50,25],[40,20],[30,15],[20,10]],
  stations: [
    {ex:"KB Swings",   gear:"25 lb",      rep:"15 reps",        url:YT("kettlebell swing form technique")},
    {ex:"Jump Rope",   gear:"Rope",       rep:"To time",        url:YT("jump rope basics beginners")},
    {ex:"Vest Squats", gear:"Vest",       rep:"12 reps",        url:YT("bodyweight squat proper form")},
    {ex:"Clean & Press",gear:"25 lb",     rep:"10 · 5/arm", url:YT("kettlebell clean and press form")},
    {ex:"Goblet Squats",gear:"15 lb",     rep:"15 reps",        url:YT("kettlebell goblet squat form")},
    {ex:"Push-ups",    gear:"Bodyweight", rep:"12–15 reps", url:YT("push up proper form")},
  ],
  personNames: [],
  theme: "Volt", voice: true, ticks: true, haptics: false, keepAwake: true, volume: 0.8, halfChime: true,
  targetMin: 0, workoutId: "kb-ladder",
};

export const WORKOUTS = [
  {
    id: "kb-ladder", name: "Full-Body KB Ladder", category: "Strength · Descending 60→20s",
    defaultPeople: 2, ladder: LADDERS["Descending"], theme: "Volt", prep: 5, targetMin: 0,
    stations: DEFAULT.stations,
  },
  {
    id: "tabata", name: "Tabata Burner", category: "Cardio · 8× 20/10",
    defaultPeople: 1, ladder: LADDERS["Tabata"], theme: "Ember", prep: 5, targetMin: 0,
    stations: [
      {ex:"Burpees",         gear:"Bodyweight", rep:"Max", url:YT("burpee proper form")},
      {ex:"Mountain Climbers",gear:"Bodyweight", rep:"Fast", url:YT("mountain climbers form")},
      {ex:"Jump Squats",     gear:"Bodyweight", rep:"Max", url:YT("jump squat form")},
      {ex:"High Knees",      gear:"Bodyweight", rep:"Fast", url:YT("high knees exercise form")},
    ],
  },
  {
    id: "bw-pyramid", name: "Bodyweight Pyramid", category: "No gear · 20→60→20s",
    defaultPeople: 2, ladder: LADDERS["Pyramid"], theme: "Ice", prep: 5, targetMin: 0,
    stations: [
      {ex:"Push-ups",       gear:"Bodyweight", rep:"12–15", url:YT("push up proper form")},
      {ex:"Air Squats",     gear:"Bodyweight", rep:"20",    url:YT("air squat form")},
      {ex:"Walking Lunges", gear:"Bodyweight", rep:"10/leg",url:YT("walking lunge form")},
      {ex:"Plank",          gear:"Bodyweight", rep:"Hold",  url:YT("forearm plank form")},
      {ex:"Mountain Climbers",gear:"Bodyweight",rep:"30s",  url:YT("mountain climbers form")},
      {ex:"Jump Rope",      gear:"Rope",       rep:"To time",url:YT("jump rope basics beginners")},
    ],
  },
  {
    id: "partner-circuit", name: "Partner Circuit", category: "Strength · Descending",
    defaultPeople: 2, ladder: LADDERS["Descending"], theme: "Candy", prep: 5, targetMin: 0,
    stations: DEFAULT.stations,
  },
  {
    id: "quick-15", name: "Quick 15", category: "Flat 40/20 · 15 min",
    defaultPeople: 2, ladder: LADDERS["Flat 40/20"], theme: "Mono", prep: 5, targetMin: 15,
    stations: [
      {ex:"KB Swings",   gear:"25 lb",      rep:"15", url:YT("kettlebell swing form technique")},
      {ex:"Push-ups",    gear:"Bodyweight", rep:"12", url:YT("push up proper form")},
      {ex:"Goblet Squats",gear:"15 lb",     rep:"15", url:YT("kettlebell goblet squat form")},
      {ex:"Jump Rope",   gear:"Rope",       rep:"time",url:YT("jump rope basics beginners")},
    ],
  },
];

// Build a full editable config from a catalog workout.
export function workoutToConfig(w) {
  return {
    ...DEFAULT,
    workoutId: w.id,
    people: w.defaultPeople,
    ladder: JSON.parse(JSON.stringify(w.ladder)),
    stations: JSON.parse(JSON.stringify(w.stations)),
    theme: w.theme || DEFAULT.theme,
    prep: w.prep ?? DEFAULT.prep,
    targetMin: w.targetMin ?? 0,
    personNames: [],
  };
}
