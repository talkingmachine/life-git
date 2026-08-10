# Earth texture attribution and processing

## Night Earth — NASA Black Marble 2016

- Runtime file: `earth-night-4k.jpg`
- Work: NASA Earth Observatory global 2016 nighttime lights composite (“Black Marble”)
- Source page: [Night Light Maps Open Up New Applications](https://science.nasa.gov/earth/earth-observatory/night-light-maps-open-up-new-applications-90008/)
- Official master: [earth_vir_2016_lrg.jpg](https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/90000/90008/earth_vir_2016_lrg.jpg)
- Credit: NASA Earth Observatory image by Joshua Stevens, using Suomi NPP VIIRS data from Miguel Román, NASA GSFC.
- Usage: NASA states that the underlying data are freely available to the science community and public; use follows [NASA media usage guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/).

### Verified source

- Dimensions: `13,500 × 6,750`, RGB JPEG
- File size: `8,106,233` bytes
- SHA-256: `230aac448ae68c358be433dd518888cccb3a85ccf66f7b44326441c324ad6725`

### Local conversion

- Pillow `12.2.0`, `Image.Resampling.LANCZOS`
- Output: `4096 × 2048`, RGB JPEG
- Encoding: quality `93`, chroma subsampling `0` (`4:4:4`), optimized Huffman tables
- File size: `951,963` bytes
- SHA-256: `3d7cfd982429631d3f88e110561ce245ad2e7f6d79bdd18dfac5535be759a842`
- No crop, compositing, retouching, or runtime network request.

### Same-size sharpness comparison before replacement

Both images were measured as 8-bit luminance at `4096 × 2048`. Higher values indicate more local
high-frequency contrast; they are diagnostic measurements, not a claim of perceptual superiority.

| Texture | Variance of Laplacian | Mean edge energy |
| --- | ---: | ---: |
| Previous runtime texture | `347.878` | `203.362` |
| NASA master downsample | `342.808` | `202.351` |

The values are close: the replacement does not manufacture extra sharpening, while retaining the
official master’s actual global light distribution and fine structure through a single Lanczos
downsample.

## Day Earth — NASA Blue Marble Shaded Relief and Bathymetry

- Runtime file: `earth-day-4k.jpg`
- Official product: [NASA Visible Earth — Blue Marble collection](https://visibleearth.nasa.gov/collection/1484/blue-marble), Blue Marble Shaded Relief and Bathymetry.
- Official source used: [NASA GIBS GetMap](https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=BlueMarble_ShadedRelief_Bathymetry&STYLES=&FORMAT=image/jpeg&TRANSPARENT=FALSE&WIDTH=4096&HEIGHT=2048&SRS=EPSG:4326&BBOX=-180,-90,180,90), EPSG:4326 full-world response.
- Reuse: NASA-produced imagery is generally not subject to U.S. copyright; provide attribution, follow [NASA media-use guidance](https://www.nasa.gov/nasa-brand-center/images-and-media/), and do not imply NASA endorsement or use NASA insignia.
- Local derivation: the native 4096 × 2048 GIBS response was written through Pillow as a progressive RGB JPEG (`quality=98`, 4:4:4); no crop, shift, reprojection, compositing, retouching, or runtime network request.
- Runtime metadata: progressive JPEG, RGB, 4096 × 2048; 2,439,516 bytes; SHA-256 `bfff43fc159947dbd0ca386427f0db28188406c309ff985d5d8203cd1f0c7658`.

## Elevation — NOAA NGDC ETOPO1 Ice Surface (2009)

- Runtime file: `earth-elevation-2k.png`
- Official product: [NOAA/NCEI ETOPO1 1 Arc-Minute Global Relief Model](https://www.ncei.noaa.gov/products/etopo-global-relief-model), NGDC ETOPO1 Ice Surface edition (2009).
- Official source used: [NOAA AOML/CoastWatch ERDDAP `etopo360` numeric `altitude` subset](https://cwcgom.aoml.noaa.gov/erddap/griddap/etopo360.nc?altitude%5B0:10:10800%5D%5B0:10:21600%5D), signed-16-bit metres; native 10,801 × 21,601 at 1 arc-minute, downloaded 10-arc-minute subset 1,081 × 2,161.
- Reuse: NOAA/ERDDAP metadata permits free use and redistribution; the dataset is not for legal or navigation use and carries no warranty. NCEI requests citation; see the [ETOPO1 FAQ](https://www.ncei.noaa.gov/sites/g/files/anmtlf171/files/2023-01/Frequently%20Asked%20Questions.pdf).
- Local derivation: removed the duplicate 360° column, rolled to −180..180, flipped north-up, cyclically sampled to 2048 × 1024, set all `altitude_m <= 0` to zero, and linearly mapped positive 1..6,527 m values to 0..255. No image-server rendering, crop, or runtime network request.
- Runtime metadata: non-interlaced PNG, 8-bit grayscale, 2048 × 1024; 2,098,948 bytes; SHA-256 `4403dcf1fc4f242961239a1bd545f259d8160013dd7d68dd6fdc6883beb821ff`.

## Terrain normal — derived from NOAA ETOPO1 elevation

- Runtime file: `earth-normal-2k.png`
- Source and reuse: derived only from the active local `earth-elevation-2k.png`; it inherits the NOAA NGDC ETOPO1 Ice Surface (2009) product, [official NOAA/NCEI product page](https://www.ncei.noaa.gov/products/etopo-global-relief-model), ERDDAP source, free-use/redistribution terms, NCEI requests citation, no-warranty, and no-navigation caveat documented above.
- Local derivation: wrap-aware X central differences and edge-clamped Y neighbours were calculated from normalized elevation; differences were divided by 255, `(-dx * 6, dy * 6, 1)` was normalized, and `(normal * 0.5 + 0.5) * 255` was rounded to RGB. No additional source imagery or runtime network request.
- Runtime metadata: non-interlaced PNG, 8-bit/color RGB, 2048 × 1024; 1,214,721 bytes; SHA-256 `977994dd53d8b126e5775a9305655e55c89aadf681d66a409a9843bbb7a20348`.
