"""
generate_dataset.py — creates 1000 synthetic ContextState rows so the Random
Forest has something to train on before any real usage history exists.

Distributions (per PERSON_2_AI_ENGINE.md):
    idleTime:      Normal(mean=45, sigma=30), clipped to [0, 600]
    rssi:           bimodal — "present" cluster ~N(-60, 8), "away" cluster ~N(-85, 6)
    phoneMoving:    correlated with the away cluster
    label user_left = 1 when rssi < -75 AND idleTime > 45 AND phoneMoving == True
                       (plus a little noise so the model isn't trivially perfect)

Run directly:  python training/generate_dataset.py
Writes:        training/mock-training-data.csv
"""

import os
import numpy as np
import pandas as pd

N_ROWS = 1000
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "mock-training-data.csv")


def generate(n_rows: int = N_ROWS, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)

    idle_time = np.clip(rng.normal(45, 30, n_rows), 0, 600).round().astype(int)

    # Bimodal RSSI: ~55% "user present" cluster, ~45% "user away" cluster
    is_away_cluster = rng.random(n_rows) < 0.45
    rssi = np.where(
        is_away_cluster,
        rng.normal(-85, 6, n_rows),
        rng.normal(-60, 8, n_rows),
    )
    rssi = np.clip(rssi, -100, -30).round().astype(int)

    # phoneMoving correlated with the away cluster (not perfectly)
    phone_moving = np.where(
        is_away_cluster,
        rng.random(n_rows) < 0.8,
        rng.random(n_rows) < 0.15,
    )

    keyboard_active = rng.random(n_rows) < 0.2
    mouse_active = rng.random(n_rows) < 0.2
    # Rarely both active AND far away — apply a little realism
    keyboard_active = keyboard_active & ~is_away_cluster
    mouse_active = mouse_active & ~is_away_cluster

    battery = np.clip(rng.normal(60, 20, n_rows), 1, 100).round().astype(int)
    charging = rng.random(n_rows) < 0.3

    label = (
        (rssi < -75) & (idle_time > 45) & phone_moving
    ).astype(int)

    # Flip ~3% of labels to add realistic noise
    flip_mask = rng.random(n_rows) < 0.03
    label = np.where(flip_mask, 1 - label, label)

    df = pd.DataFrame({
        "idleTime": idle_time,
        "rssi": rssi,
        "phoneMoving": phone_moving.astype(int),
        "keyboardActive": keyboard_active.astype(int),
        "mouseActive": mouse_active.astype(int),
        "battery": battery,
        "charging": charging.astype(int),
        "user_left": label,
    })
    return df


if __name__ == "__main__":
    df = generate()
    df.to_csv(OUTPUT_PATH, index=False)
    print(f"Wrote {len(df)} synthetic rows to {OUTPUT_PATH}")
    print(df["user_left"].value_counts(normalize=True))
