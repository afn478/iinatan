# Controller Controls

iinatan's controller support is disabled by default. Enable **Enable controller input** in the Advanced settings for the active profile. It supports controllers recognized by macOS and may ask for Input Monitoring permission the first time it is enabled.

Controller input is active while the IINA window is in the foreground, iinatan is enabled, and a recognized controller is connected. Button actions can be customized independently for the **No Popup**, **With Popup**, and **Audio List** contexts in Settings.

## Default button mappings

The default mappings use the standard gamepad face-button order: **Cross** is the primary button, **Circle** is the back button, **Square** is the west button, and **Triangle** is the north button. The labels shown by macOS or the controller may differ.

### No Popup

| Control | Action |
| --- | --- |
| Cross | Open a lookup. |
| Circle | Resume playback. |
| Square | Toggle playback pause and resume. |
| Triangle | Open the audio list. |
| L1 / R1 | Seek to the previous / next subtitle. |
| L2 / R2 | Add to Anki anyway / add to Anki. |
| D-pad Up / Down | Seek backward / forward 60 seconds. |
| D-pad Left / Right | Seek backward / forward 5 seconds. |

### With Popup

| Control | Action |
| --- | --- |
| Cross | Select the most visible dictionary entry. |
| Circle | Close the popup. |
| Square | Toggle playback pause and resume. |
| Triangle | Open the audio list. |
| L1 / R1 | Seek to the previous / next subtitle. |
| L2 / R2 | Add to Anki anyway / add to Anki. |
| D-pad Up / Down | Scroll the popup up / down. |
| D-pad Left / Right | Select the previous / next dictionary entry. |

### Audio List

| Control | Action |
| --- | --- |
| Cross | Choose the focused audio source. |
| Circle | Close the audio list. |
| D-pad Up / Down | Move to the previous / next audio source. |
| D-pad Left / Right | Move between audio-source and export controls. |

## Sticks and holds

| Control | Action |
| --- | --- |
| Left stick Up / Down | Smooth-scroll the open popup or audio list. |
| Right stick | Move the active lookup across subtitle text: left/right between words and up/down between subtitle rows. |
| Triangle (hold) | Open the audio list; releasing before the hold completes plays the selected entry's audio. |
| L2 / R2 (hold) | Run the configured Anki action after the hold completes. |

Holding Triangle, L2, or R2 shows a progress indicator. Button mappings can be reset independently from the controller settings.
