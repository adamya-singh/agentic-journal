// The SO-ARM-101 experiment record as it stood on 2026-11-22, when the page was built: the store starts from
// this the first time it is read on a machine with no experiments file. After that the file is the record.
import type { ExperimentStore } from './types.ts';

export const SEED: ExperimentStore = {
  "version": 1,
  "project": "SO-ARM-101",
  "directions": [
    {
      "id": "main",
      "name": "Main policy",
      "hue": 0,
      "order": 0
    },
    {
      "id": "calib",
      "name": "Sim matches real",
      "hue": 1,
      "order": 1
    },
    {
      "id": "repairs",
      "name": "Patching the clone",
      "hue": 2,
      "order": 2
    },
    {
      "id": "vision",
      "name": "From pixels",
      "hue": 3,
      "order": 3
    },
    {
      "id": "placement",
      "name": "Cube anywhere",
      "hue": 4,
      "order": 4
    },
    {
      "id": "robust",
      "name": "Robust to the real arm",
      "hue": 5,
      "order": 5
    },
    {
      "id": "vla",
      "name": "Big pretrained models",
      "hue": 6,
      "order": 6
    },
    {
      "id": "probes",
      "name": "What did it learn?",
      "hue": 7,
      "order": 7
    }
  ],
  "experiments": [
    {
      "id": "00",
      "when": "2026-07-31",
      "day": "Jan – Jul",
      "order": 0,
      "direction": "main",
      "status": "failed",
      "question": "Can teleop data and RL teach the arm?",
      "answer": "No. ACT trained on 100 hand-guided episodes drifted downward on the real arm, and months of RL made no grasp.",
      "numbers": [
        "100 real episodes",
        "7 months of RL"
      ],
      "details": "This is where the project stood before the rebuild. The reason the RL never worked only showed up in experiment 01.",
      "buildsOn": [],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "droop",
      "model": ""
    },
    {
      "id": "01",
      "when": "2026-08-01",
      "day": "Aug 1",
      "order": 1,
      "direction": "main",
      "status": "finding",
      "question": "Can the task even be solved?",
      "answer": "No: the simulator made the grasp impossible. With a new arm model the scripted controller passed 15/15.",
      "numbers": [
        "15/15 after the fix"
      ],
      "details": "The simulator made a strict face grasp physically impossible, so seven months of RL had been training on a broken task. Check the collision model before trusting any grasp result.",
      "buildsOn": [
        "00"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "jaws",
      "model": ""
    },
    {
      "id": "02",
      "when": "2026-08-02",
      "day": "Aug 2",
      "order": 2,
      "direction": "main",
      "status": "failed",
      "question": "Can a small network copy the cheating script?",
      "answer": "On paper yes, in the sim 0/3: errors compound once the arm leaves the recorded path.",
      "numbers": [
        "0/3"
      ],
      "details": "A network copied the script almost perfectly on paper, then failed every real try, because tiny errors piled up until the arm was somewhere it had never seen.",
      "buildsOn": [
        "01"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "diverge",
      "model": "mlp"
    },
    {
      "id": "03",
      "when": "2026-08-02",
      "day": "Aug 2",
      "order": 3,
      "direction": "repairs",
      "status": "failed",
      "question": "Can a few recovery examples teach it to recover?",
      "answer": "No. Eight examples made it worse.",
      "numbers": [
        "0/15",
        "8 recovery rows"
      ],
      "details": "I added 8 examples of the script recovering from small mistakes. The clone failed all 15 tries and started slamming into its joint limits.",
      "buildsOn": [
        "02"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "anchors",
      "model": "mlp"
    },
    {
      "id": "04",
      "when": "2026-08-02",
      "day": "Aug 2",
      "order": 4,
      "direction": "repairs",
      "status": "failed",
      "question": "What if the recovery examples count for less?",
      "answer": "No weight worked, and my static safety check turned out to be useless.",
      "numbers": [
        "0/3 at every weight"
      ],
      "details": "Turning down the weight of the 8 recovery rows did not help: every version that trained still failed on safety.",
      "buildsOn": [
        "03"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "weights",
      "model": "mlp"
    },
    {
      "id": "05",
      "when": "2026-08-02",
      "day": "Aug 2",
      "order": 5,
      "direction": "repairs",
      "status": "failed",
      "question": "Is the network just missing information?",
      "answer": "No. Velocity, contact flags and history did not help.",
      "numbers": [
        "0/3 × 3 versions"
      ],
      "details": "All three versions memorized fast and failed. The inputs were not the problem.",
      "buildsOn": [
        "02"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "inputs",
      "model": "mlp"
    },
    {
      "id": "06",
      "when": "2026-08-02",
      "day": "Aug 2–3",
      "order": 6,
      "direction": "repairs",
      "status": "failed",
      "question": "What if it learns from its own mistakes?",
      "answer": "The DAgger capture worked, but the small network could not fit it.",
      "numbers": [
        "4,818 correction rows"
      ],
      "details": "I recorded 4,818 rows of the script fixing the clone’s actual mistakes. The data was right; the step-by-step network could not even fit it. This branch ends here.",
      "buildsOn": [
        "02"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "cloud",
      "model": "mlp"
    },
    {
      "id": "07",
      "when": "2026-08-03",
      "day": "Aug 3",
      "order": 7,
      "direction": "main",
      "status": "mixed",
      "question": "What if it decides less often?",
      "answer": "90-step chunks gave the first learned grasp, then the arm drove itself into its joint limits.",
      "numbers": [
        "first learned strict grasp"
      ],
      "details": "Predicting 90 actions at a time means far fewer decisions per episode, so far fewer chances to drift. The new failure was asking for impossible moves.",
      "buildsOn": [
        "02",
        "06"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "chunk",
      "model": "chunk"
    },
    {
      "id": "08",
      "when": "2026-08-03",
      "day": "Aug 3",
      "order": 8,
      "direction": "main",
      "status": "worked",
      "question": "How do we stop it asking for impossible moves?",
      "answer": "Noise on the inputs plus a penalty for infeasible commands: the first passing policy.",
      "numbers": [
        "3/3",
        "0 safety frames"
      ],
      "details": "The first learned policy to do the full pick and place with zero safety frames.",
      "buildsOn": [
        "07"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "corridor",
      "model": "chunk"
    },
    {
      "id": "09",
      "when": "2026-08-03",
      "day": "Aug 3",
      "order": 9,
      "direction": "calib",
      "status": "finding",
      "question": "Why did the same run give different numbers?",
      "answer": "A stray pip install had swapped the physics engine mid-project.",
      "numbers": [
        "MuJoCo 3.11 vs 3.9",
        "34 results quarantined"
      ],
      "details": "34 results came from a different simulator than the rest. The project standardized on 3.9.0 with a version guard, and the affected runs were redone.",
      "buildsOn": [
        "08"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "twin",
      "model": ""
    },
    {
      "id": "10",
      "when": "2026-08-04",
      "day": "Aug 4",
      "order": 10,
      "direction": "main",
      "status": "mixed",
      "question": "Is it a policy or a recording?",
      "answer": "A recording: moving the cube 1.5 mm broke it. Retraining on 5 starts almost works.",
      "numbers": [
        "1.5 mm breaks it",
        "0/15 strict"
      ],
      "details": "The first policy learned one recording of one cube position. Trained on 5 positions it almost worked everywhere, but not quite anywhere.",
      "buildsOn": [
        "08"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "starts",
      "model": "chunk"
    },
    {
      "id": "11",
      "when": "2026-08-06",
      "day": "Aug 6",
      "order": 11,
      "direction": "main",
      "status": "mixed",
      "question": "Do more steps or a wider network finish the job?",
      "answer": "9/15. Every failure was the gripper misbehaving after the recording ran out.",
      "numbers": [
        "9/15"
      ],
      "details": "The best combination of training length and width got 9/15, and all the bad frames were in one place: the gripper channel, past the end of the script’s recording.",
      "buildsOn": [
        "10"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "bargrid",
      "model": "chunk"
    },
    {
      "id": "12",
      "when": "2026-08-06",
      "day": "Aug 6",
      "order": 12,
      "direction": "main",
      "status": "mixed",
      "question": "Does a better learning-rate schedule fix it?",
      "answer": "Cosine decay cut bad frames 17× and reached 12/15, but seeds scatter.",
      "numbers": [
        "12/15",
        "seeds 12 · 12 · 3"
      ],
      "details": "Bigger budgets made it worse, and the same recipe gave 12, 12 and 3 across three seeds.",
      "buildsOn": [
        "11"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "cosine",
      "model": "chunk"
    },
    {
      "id": "13",
      "when": "2026-08-06",
      "day": "Aug 6",
      "order": 13,
      "direction": "main",
      "status": "failed",
      "question": "What if the recording covers the whole task?",
      "answer": "It fixed a problem that was already gone. The real cause was the gripper squeezing past its limit.",
      "numbers": [
        "480-step teacher",
        "seeds 9 · 9 · 12"
      ],
      "details": "Extending the recording to all 480 steps removed every past-the-end violation and changed nothing, because the remaining failures were over-squeeze inside the recording.",
      "buildsOn": [
        "12"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "horizon",
      "model": "chunk"
    },
    {
      "id": "14",
      "when": "2026-08-06",
      "day": "Aug 6",
      "order": 14,
      "direction": "main",
      "status": "worked",
      "question": "Can we just clip the gripper?",
      "answer": "Yes: the first 15/15 with zero safety frames, on 2 of 3 seeds.",
      "numbers": [
        "15/15",
        "no retraining"
      ],
      "details": "Clipping the gripper command to its limits at run time fixed it without touching the weights.",
      "buildsOn": [
        "13"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "clamp",
      "model": "chunk"
    },
    {
      "id": "15",
      "when": "2026-08-06",
      "day": "Aug 6",
      "order": 15,
      "direction": "vision",
      "status": "failed",
      "question": "Can it do this from pixels?",
      "answer": "Badly, and it mostly ignored the image.",
      "numbers": [
        "0–3/15",
        "blank camera: same"
      ],
      "details": "The first vision policy was bad as expected. Blanking the camera barely changed its behaviour, which is the check that told us it was not really looking.",
      "buildsOn": [
        "14"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "ignore",
      "model": "cnn"
    },
    {
      "id": "16",
      "when": "2026-08-06",
      "day": "Aug 6",
      "order": 16,
      "direction": "vision",
      "status": "mixed",
      "question": "Does it work on cube positions it has never seen?",
      "answer": "With exact cube position 18/30. From pixels 0/30.",
      "numbers": [
        "state 18/30",
        "vision 0/30"
      ],
      "details": "Trained on 25 random cube positions, the state policy solved 6 of 10 new positions perfectly. The vision policy solved none.",
      "buildsOn": [
        "15",
        "14"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "scatter25",
      "model": "cnn"
    },
    {
      "id": "17",
      "when": "2026-08-07",
      "day": "Aug 7–8",
      "order": 17,
      "direction": "vision",
      "status": "worked",
      "question": "Is it a data problem?",
      "answer": "Yes. 400 positions gave the state policy 30/30, and vision reached 24–30/30 once training grew with the data.",
      "numbers": [
        "state 30/30",
        "vision 24 · 30 · 24"
      ],
      "details": "The first perfect score from camera input alone. Seed spread remained.",
      "buildsOn": [
        "16"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "stairs",
      "model": "cnn"
    },
    {
      "id": "18",
      "when": "2026-09-06",
      "day": "Sep 6",
      "order": 18,
      "direction": "calib",
      "status": "worked",
      "question": "Can the script do the real bench task?",
      "answer": "Yes, after fixing the axis the grasp checker measured.",
      "numbers": [
        "25.4° off",
        "certified 15/15"
      ],
      "details": "The script could not make a strict grasp on the new 20 mm cube. The checker had been measuring along the fingertip line instead of the pad normals all along.",
      "buildsOn": [
        "14"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "axis",
      "model": ""
    },
    {
      "id": "19",
      "when": "2026-09-06",
      "day": "Sep 6",
      "order": 19,
      "direction": "calib",
      "status": "finding",
      "question": "Does the sim camera see what the real camera sees?",
      "answer": "No: the sim showed the square 4× smaller and 300 px lower.",
      "numbers": [
        "4.1× smaller",
        "300 px lower"
      ],
      "details": "I had never compared the sim’s wrist camera with the real one at the same pose.",
      "buildsOn": [
        "18"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "frames",
      "model": ""
    },
    {
      "id": "20",
      "when": "2026-09-07",
      "day": "Sep 7",
      "order": 20,
      "direction": "calib",
      "status": "finding",
      "question": "Are the sim’s joint angles the real arm’s?",
      "answer": "No: wrist roll was a quarter turn off, other joints up to 30°.",
      "numbers": [
        "wrist roll ~94°",
        "elbow ~14°"
      ],
      "details": "My first measurement made it look even worse than it was; that reading was later withdrawn.",
      "buildsOn": [
        "18"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "ghostroll",
      "model": ""
    },
    {
      "id": "21",
      "when": "2026-09-08",
      "day": "Sep 8",
      "order": 21,
      "direction": "calib",
      "status": "finding",
      "question": "What lens does the camera really have?",
      "answer": "44°, not the 72° the sim used. Joint zeros corrected with a checkerboard on a phone.",
      "numbers": [
        "fovy 44°",
        "teacher 15/15"
      ],
      "details": "A checkerboard shown on my phone gave the lens model, and board-pose consistency gave one more correction to the joint zeros.",
      "buildsOn": [
        "19",
        "20"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "checker",
      "model": ""
    },
    {
      "id": "22",
      "when": "2026-09-08",
      "day": "Sep 8",
      "order": 22,
      "direction": "main",
      "status": "worked",
      "question": "Does the recipe learn the bench task from pixels?",
      "answer": "27/30 on new cube positions, and 0/30 with a black image, so it really uses the camera.",
      "numbers": [
        "27/30",
        "black image 0/33"
      ],
      "details": "The first real evidence on the bench task: the vision recipe from August, on the calibrated scene.",
      "buildsOn": [
        "17",
        "21",
        "14"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "bench",
      "model": "cnn"
    },
    {
      "id": "23",
      "when": "2026-09-09",
      "day": "Sep 9",
      "order": 23,
      "direction": "calib",
      "status": "worked",
      "question": "Can the sim see through the real lens?",
      "answer": "Yes. Rendering through the real lens instead of straightening real images gave 30/30.",
      "numbers": [
        "30/30",
        "no undistortion"
      ],
      "details": "The real camera bends the image. Making the simulator bend it the same way was simpler and better than undistorting.",
      "buildsOn": [
        "21",
        "22"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "barrel",
      "model": "cnn"
    },
    {
      "id": "24",
      "when": "2026-09-09",
      "day": "Sep 9",
      "order": 24,
      "direction": "main",
      "status": "failed",
      "question": "Does it work on the real arm?",
      "answer": "No. The runner and safety system worked, but the very first move on the real image was wrong.",
      "numbers": [
        "2 live attempts"
      ],
      "details": "The policy had only ever seen one look of the scene. The real image’s lighting and texture threw it off.",
      "buildsOn": [
        "22",
        "23"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "looks2",
      "model": "cnn"
    },
    {
      "id": "25",
      "when": "2026-09-10",
      "day": "Sep 10",
      "order": 25,
      "direction": "main",
      "status": "worked",
      "question": "Can it handle how the real scene looks?",
      "answer": "Yes: randomized lighting, colours and textures kept 30/30 and passed a check on real frames.",
      "numbers": [
        "30/30",
        "real-frame gate passes"
      ],
      "details": "An offline gate on recorded real frames now says whether a policy is safe to try live. The old policy fails it and this one passes.",
      "buildsOn": [
        "24"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "fan",
      "model": "cnn"
    },
    {
      "id": "26",
      "when": "2026-09-10",
      "day": "Sep 10",
      "order": 26,
      "direction": "main",
      "status": "finding",
      "question": "Why does it miss the real cube?",
      "answer": "The cube sat 20–40 mm from where the task assumed, and a strict safety rule kept freezing the arm.",
      "numbers": [
        "20–40 mm off"
      ],
      "details": "The plan ran fine and the jaws closed beside the cube. The safety gate now rate-limits and continues instead of holding.",
      "buildsOn": [
        "25"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "miss",
      "model": ""
    },
    {
      "id": "27",
      "when": "2026-09-10",
      "day": "Sep 10",
      "order": 27,
      "direction": "main",
      "status": "worked",
      "question": "Does it work now?",
      "answer": "Yes, once. The real arm grasped the cube, lifted it and put it back.",
      "numbers": [
        "18.6 mm lift",
        "back within 3 mm"
      ],
      "details": "Episode 10: the first live success of the project.",
      "buildsOn": [
        "26"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "lift",
      "model": "cnn"
    },
    {
      "id": "28",
      "when": "2026-09-10",
      "day": "Sep 10",
      "order": 28,
      "direction": "main",
      "status": "failed",
      "question": "Can it do it again?",
      "answer": "No. It goes to a learned spot, not to the cube.",
      "numbers": [
        "missed by ~10 mm"
      ],
      "details": "Every real grasp landed in about the same place wherever the cube was, so the policy had no tolerance for placement.",
      "buildsOn": [
        "27"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "samespot",
      "model": ""
    },
    {
      "id": "29",
      "when": "2026-09-10",
      "day": "Sep 10",
      "order": 29,
      "direction": "placement",
      "status": "failed",
      "question": "Can it find a cube anywhere on the table?",
      "answer": "3/30. It memorized its 400 placements.",
      "numbers": [
        "3/30",
        "gap 136×"
      ],
      "details": "Square and cube anywhere in a 14 × 10 inch rectangle, at any yaw. Held-out error was 136 times the training error.",
      "buildsOn": [
        "28"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "placements",
      "model": "cnn"
    },
    {
      "id": "30",
      "when": "2026-09-10",
      "day": "Sep 10",
      "order": 30,
      "direction": "placement",
      "status": "failed",
      "question": "Does 3× the placements fix it?",
      "answer": "No: the same 3/30, and the gap grew.",
      "numbers": [
        "3/30",
        "gap 417×"
      ],
      "details": "1200 placements and twice the training made the memorization gap bigger.",
      "buildsOn": [
        "29"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "gap2",
      "model": "cnn"
    },
    {
      "id": "31",
      "when": "2026-09-11",
      "day": "Sep 11",
      "order": 31,
      "direction": "placement",
      "status": "finding",
      "question": "Do more data, a bigger network or longer training fix it?",
      "answer": "None of them. A nearest-neighbour lookup table beat every network.",
      "numbers": [
        "loss flat on all 3 axes",
        "lookup 5× better"
      ],
      "details": "A ladder over placements, encoder size and steps left held-out loss flat. The bottleneck was reading the image, not scale.",
      "buildsOn": [
        "30"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "lattice",
      "model": "cnn"
    },
    {
      "id": "32",
      "when": "2026-09-12",
      "day": "Sep 12",
      "order": 32,
      "direction": "placement",
      "status": "mixed",
      "question": "Can we make memorizing impossible?",
      "answer": "Sliding every training image a few pixels at random cut the gap 350×.",
      "numbers": [
        "gap 5250× → 15×",
        "0/30 → 9/30"
      ],
      "details": "Random shifts of up to 12 px mean the network never sees the exact same image twice.",
      "buildsOn": [
        "31"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "shift",
      "model": "cnn"
    },
    {
      "id": "33",
      "when": "2026-09-12",
      "day": "Sep 12",
      "order": 33,
      "direction": "placement",
      "status": "mixed",
      "question": "Now, do steps or placements help?",
      "answer": "Longer training brought memorization back. More placements kept it away.",
      "numbers": [
        "480k steps: 0/30",
        "2400 placements: 15/30"
      ],
      "details": "Steps re-memorize; data pays.",
      "buildsOn": [
        "32"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "fork",
      "model": "cnn"
    },
    {
      "id": "34",
      "when": "2026-09-12",
      "day": "Sep 12",
      "order": 34,
      "direction": "placement",
      "status": "finding",
      "question": "How much of 15/30 is luck?",
      "answer": "A lot. The same recipe scored 15, 6 and 12.",
      "numbers": [
        "15 · 6 · 12 of 30"
      ],
      "details": "The loss reproduced across seeds and the closed-loop score did not. Recipes are now judged by loss across seeds and pooled rollouts.",
      "buildsOn": [
        "33"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "seeds",
      "model": "cnn"
    },
    {
      "id": "35",
      "when": "2026-09-13",
      "day": "Sep 13",
      "order": 35,
      "direction": "placement",
      "status": "mixed",
      "question": "Does doubling the placements again help?",
      "answer": "Memorization was gone, closed loop fell to 6/30, and I misread why.",
      "numbers": [
        "gap 1.6×",
        "6/30"
      ],
      "details": "4800 placements. Half the poses lifted the cube by an edge. My first reading, that loss had stopped predicting success, was wrong.",
      "buildsOn": [
        "33"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "pillars",
      "model": "cnn"
    },
    {
      "id": "36",
      "when": "2026-09-18",
      "day": "Sep 18",
      "order": 36,
      "direction": "placement",
      "status": "finding",
      "question": "Why does a policy that looks fine on paper still miss?",
      "answer": "It lands about 10 mm off against an 8 mm tolerance, and its second look at the cube corrects nothing.",
      "numbers": [
        "10 mm scatter",
        "8 mm tolerance"
      ],
      "details": "Measured in millimetres, the placement policy is open-loop after its first survey frame: the chunk at step 180 moves the error from 11.4 to 11.2 mm.",
      "buildsOn": [
        "35",
        "34"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "bullseye",
      "model": "cnn"
    },
    {
      "id": "37",
      "when": "2026-10-02",
      "day": "Oct 2–3",
      "order": 37,
      "direction": "vla",
      "status": "mixed",
      "question": "Does a big pretrained model place better?",
      "answer": "Best held-out loss so far, and half the poses succeed when it replans every 30 steps.",
      "numbers": [
        "held-out 2.5e-4",
        "5/10 poses",
        "closure 4 mm"
      ],
      "details": "pi0.5 fine-tuned on the placement captures. Failures moved from where it lands to how well it grips.",
      "buildsOn": [
        "36"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "pi05",
      "model": ""
    },
    {
      "id": "38",
      "when": "2026-10-04",
      "day": "Oct 4",
      "order": 38,
      "direction": "vla",
      "status": "failed",
      "question": "Does pi0.5 work on the real arm?",
      "answer": "No. The arm swung about 105° sideways and pressed on the table until it was unplugged.",
      "numbers": [
        "elbow lag 7–8 vs 2–3 in sim"
      ],
      "details": "The real elbow lags far more than the simulated one, and each replan re-anchored on the lagging pose, so the survey move stopped short. Workspace, visibility and stall guards were added afterwards.",
      "buildsOn": [
        "37"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "incident",
      "model": "pi05"
    },
    {
      "id": "39",
      "when": "2026-10-04",
      "day": "Oct 4",
      "order": 39,
      "direction": "calib",
      "status": "mixed",
      "question": "How does the real servo actually respond?",
      "answer": "The elbow is a soft P servo that rests short of its target. An assist brings the jaw error to about 4 mm.",
      "numbers": [
        "10 mm → 4 mm",
        "pi0.5 still 0/10"
      ],
      "details": "A probe measured the response once. A measured-servo scene was built from it, and the runner got a servo assist.",
      "buildsOn": [
        "38",
        "23"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "servo",
      "model": ""
    },
    {
      "id": "40",
      "when": "2026-10-04",
      "day": "Oct 4–5",
      "order": 40,
      "direction": "vla",
      "status": "mixed",
      "question": "Which model family is worth retrying?",
      "answer": "ACT tuned with PPO scored best. SmolVLA barely worked.",
      "numbers": [
        "ACT + PPO 24/30",
        "pi0.5 ReinFlow 21/30",
        "ACT 20/30",
        "SmolVLA 2/30"
      ],
      "details": "A retry tranche across three model families, fine-tuned and then improved with RL in the simulator.",
      "buildsOn": [
        "37",
        "38"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "podium",
      "model": "act"
    },
    {
      "id": "41",
      "when": "2026-11-05",
      "day": "Nov 5",
      "order": 41,
      "direction": "robust",
      "status": "mixed",
      "question": "What if it trains on its own mistakes?",
      "answer": "A teacher that recentres 20 mm above the cube. The gain was hidden by the old gripper.",
      "numbers": [
        "ACT baselines already < 4 mm"
      ],
      "details": "The capture starts from perturbed poses and labels the correction. On the narrow SO-100 gripper the benefit was masked; it shows up later on the SO-101.",
      "buildsOn": [
        "36"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "recentre",
      "model": "act"
    },
    {
      "id": "42",
      "when": "2026-11-05",
      "day": "Nov 5",
      "order": 42,
      "direction": "robust",
      "status": "mixed",
      "question": "Can randomized physics cover the real servos?",
      "answer": "It learned the one soft servo it was shown, not servos in general.",
      "numbers": [
        "stiff elbow 0/30"
      ],
      "details": "Randomizing around the measured servo taught the policy that servo. Replanning more often did not help.",
      "buildsOn": [
        "39",
        "36"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "sagfan",
      "model": "act"
    },
    {
      "id": "43",
      "when": "2026-11-06",
      "day": "Nov 6",
      "order": 43,
      "direction": "calib",
      "status": "worked",
      "question": "Does the newer SO-101 model help?",
      "answer": "Yes. Its wider gripper gives the grasp more tolerance.",
      "numbers": [
        "teacher 30/30",
        "camera within 0.2 mm"
      ],
      "details": "New bench scenes on the Menagerie SO-101 with two sets of dynamics. The gain is grasp tolerance.",
      "buildsOn": [
        "39"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "grippers2",
      "model": ""
    },
    {
      "id": "44",
      "when": "2026-11-08",
      "day": "Nov 8–12",
      "order": 44,
      "direction": "calib",
      "status": "finding",
      "question": "What are the servo gains on the real arm?",
      "answer": "Every servo is set to P 16, half the factory value.",
      "numbers": [
        "P = 16",
        "factory 32"
      ],
      "details": "The SO-101 became the base model with a refitted servo scene, and a read-only register reader confirmed where the softness comes from.",
      "buildsOn": [
        "43"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "registers",
      "model": ""
    },
    {
      "id": "45",
      "when": "2026-11-08",
      "day": "Nov 8–9",
      "order": 45,
      "direction": "robust",
      "status": "worked",
      "question": "What if the randomization spans soft to stiff?",
      "answer": "It survives real-like servos where the baseline scores zero.",
      "numbers": [
        "real-like 19/30 vs 0/30",
        "nominal 24 vs 25"
      ],
      "details": "Physics regime v2 randomizes each joint from the measured soft servo to the stiff nominal one. ACT replanning every 30 steps became the candidate for the real arm.",
      "buildsOn": [
        "42",
        "44"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "springs",
      "model": "act"
    },
    {
      "id": "46",
      "when": "2026-11-08",
      "day": "Nov 8–9",
      "order": 46,
      "direction": "robust",
      "status": "mixed",
      "question": "Do corrections help on the SO-101?",
      "answer": "Yes for the CNN. ACT learned to hover, because its data had no chunk starts at steps 120 and 150.",
      "numbers": [
        "CNN 74/90 vs 59/90",
        "6.4 vs 8.5 mm",
        "ACT 0/30 at execute 30"
      ],
      "details": "The perturbed teacher from experiment 41, rerun on the wider gripper.",
      "buildsOn": [
        "41",
        "44"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "chunkstarts",
      "model": "act"
    },
    {
      "id": "47",
      "when": "2026-11-12",
      "day": "Nov 12",
      "order": 47,
      "direction": "main",
      "status": "mixed",
      "question": "Does the physics-v2 ACT work live?",
      "answer": "It reaches and closes on the cube every time and lifted it briefly once. Range holds aborted two runs.",
      "numbers": [
        "live episodes 26–28"
      ],
      "details": "The runner now rises from below the floor limit and masks only inward range violations.",
      "buildsOn": [
        "45",
        "28"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "floorRise",
      "model": "act"
    },
    {
      "id": "48",
      "when": "2026-11-12",
      "day": "Nov 12–17",
      "order": 48,
      "direction": "main",
      "status": "mixed",
      "question": "Can it carry the cube high?",
      "answer": "7 of 17 live runs carried the cube with a real 100 mm lift.",
      "numbers": [
        "7 carries / 17",
        "6 misses",
        "far placements fail"
      ],
      "details": "Misses are jaws stopping short. Two estimates of the cube’s position disagree by 22 mm, so the next fix is geometry, then a slower release.",
      "buildsOn": [
        "47"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "highlift",
      "model": "act"
    },
    {
      "id": "49",
      "when": "2026-11-18",
      "day": "Nov 18",
      "order": 49,
      "direction": "probes",
      "status": "finding",
      "question": "Do the policies really use the camera?",
      "answer": "Yes. With a black image both drop from 21/30 to 0/30.",
      "numbers": [
        "ACT 21 → 0",
        "CNN 21 → 0",
        "~11 cm misses"
      ],
      "details": "The pixel-reliance check from August, repeated on the current ACT and CNN.",
      "buildsOn": [
        "48",
        "22"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "blackout",
      "model": ""
    },
    {
      "id": "50",
      "when": "2026-11-18",
      "day": "Nov 18",
      "order": 50,
      "direction": "probes",
      "status": "finding",
      "question": "Was CNN versus ACT a fair fight?",
      "answer": "It was not. On the same data the small CNN matches ACT, and holds up better on real-like servos.",
      "numbers": [
        "servo 64/90 vs 21/30",
        "real-like 41/90 vs 8/30"
      ],
      "details": "The CNN recipe retrained on all 7149 high-lift placements with three seeds, and allowed to replan every 30 steps like ACT.",
      "buildsOn": [
        "48"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "versus",
      "model": ""
    },
    {
      "id": "51",
      "when": "2026-11-18",
      "day": "Nov 18 →",
      "order": 51,
      "direction": "robust",
      "status": "running",
      "question": "Do joint offsets and past commands help?",
      "answer": "The sweep kept the current settings (21/30). The 2 × 2 ablation is still training.",
      "numbers": [
        "baseline 21/30",
        "24 pickups",
        "5.6 mm"
      ],
      "details": "Random ±3° joint offsets per episode, and the last three commands as an extra input, each against a tuned baseline with two seeds.",
      "buildsOn": [
        "48",
        "45"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "offsets",
      "model": "act"
    },
    {
      "id": "52",
      "when": "2026-11-18",
      "day": "Nov 18",
      "order": 52,
      "direction": "probes",
      "status": "worked",
      "question": "Does each data change create its own skill?",
      "answer": "Yes. 12 of 13 predictions registered in advance held.",
      "numbers": [
        "follows a 20 mm shift: +0.73 vs +0.01",
        "12/13"
      ],
      "details": "Mid-episode the cube is moved or the elbow goes soft, and the result is paired with the untouched episode. Policies trained on corrections follow the cube; policies trained on random physics keep their grip.",
      "buildsOn": [
        "46",
        "45"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "probe",
      "model": ""
    },
    {
      "id": "53",
      "when": "2026-11-19",
      "day": "Nov 19–21",
      "order": 53,
      "direction": "probes",
      "status": "finding",
      "question": "Do skills stack, combine and get cheaper in order?",
      "answer": "Two skills stack in one policy and combine in an episode it never saw. Order does not matter for this pair.",
      "numbers": [
        "follow gain +0.74 / +0.91",
        "pickups kept 72% / 79% (bar 80%)",
        "order lead −0.00 and +0.02 (bar 0.10)"
      ],
      "details": "Three questions: can one policy hold both skills, do both work in one episode, and does having one make the next cheaper to learn.",
      "buildsOn": [
        "52"
      ],
      "notes": "",
      "flagged": false,
      "groups": [],
      "picture": "stack",
      "model": "act"
    }
  ]
};
