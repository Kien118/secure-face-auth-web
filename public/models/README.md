# Model assets (downloaded locally, ignored by Git)

Run `npm run models:download` after `npm ci`. `models.lock.json` pins the original
face-api.js 0.22.2 source commit, exact filenames and SHA-256 checksums.
Three required networks: Tiny Face Detector, tiny 68-point landmarks, face recognition.
The script downloads only manifests, weights and the upstream MIT LICENSE, no face photos.
Assets are served locally; no CDN scripts or continuous cloud video upload.

Source: https://github.com/justadudewhohacks/face-api.js
Upstream license: MIT, copyright 2018 Vincent Mühler; downloaded as `LICENSE`.
Keep the notice with any redistributed upstream assets. Model weights stay outside Git.
No claim of certified PAD, training-data provenance audit or production suitability.
