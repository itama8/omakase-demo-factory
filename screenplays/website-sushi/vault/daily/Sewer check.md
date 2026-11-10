# Sewer check

Checking the model against the CPHEEO manual. Conduit data is illustrative.


| Conduit | Dia (mm) | Material | Velocity (m/s) | Limit (m/s) |
|---|---|---|---|---|
| C-01 | 200 | RCC | 0.95 | 0.8 |
| C-02 | 200 | RCC | 0.76 | 0.8 |
| C-03 | 200 | RCC | 0.55 | 0.8 |
| C-04 | 250 | RCC | 0.86 | 0.8 |
| C-05 | 250 | RCC | 0.70 | 0.8 |
| C-06 | 300 | RCC | 0.94 | 0.8 |
| C-07 | 300 | RCC | 0.61 | 0.8 |
| C-08 | 400 | RCC | 1.21 | 0.8 |

```chart
type: line
data: table:1
x: Conduit
y: Velocity (m/s), Limit (m/s)
title: Velocity by conduit
ylabel: m/s
```

Velocity check against the manual:
