#!/usr/bin/env bash
# Sets up lod2-floorplan: a Python environment, and Raster2Seq (the room model) at the
# tested commit, patched for current PyTorch and built for this graphics card.
#
#   ./setup.sh             service and room model (needs an NVIDIA card and the CUDA compiler)
#   ./setup.sh --no-model  service only: walls from the drawing alone, no GPU needed
#
# TORCH_INDEX picks the PyTorch build; its CUDA major version must match `nvcc --version`
# (default cu130 for CUDA 13; use https://download.pytorch.org/whl/cu128 for CUDA 12).
set -euo pipefail
cd "$(dirname "$0")"

RASTER2SEQ_COMMIT=a6c4e27a68d11d7a459f6e4a2601fd887227dd1a
TORCH_INDEX="${TORCH_INDEX:-https://download.pytorch.org/whl/cu130}"

[[ -d .venv ]] || uv venv -q --python 3.10 .venv
uv pip install -q --python .venv/bin/python -r requirements.txt
[[ "${1:-}" == "--no-model" ]] && { echo "Service ready, without the room model."; exit 0; }

uv pip install -q --python .venv/bin/python torch torchvision --index-url "$TORCH_INDEX"
if [[ ! -d .raster2seq ]]; then
  git clone -q https://github.com/Cornell-VAILab/Raster2Seq.git .raster2seq
fi
git -C .raster2seq checkout -q "$RASTER2SEQ_COMMIT"
git -C .raster2seq checkout -q -- .

# Its pins conflict (scipy 1.8 wants numpy < 1.25 next to numpy 1.26), and plotly is missing.
sed -e 's/^scipy==1.8.1/scipy<1.14/' -e 's/^scikit-image==0.19.0/scikit-image<0.23/' -e 's/^wandb==.*/wandb/' \
  .raster2seq/requirements.txt > .raster2seq/requirements-relaxed.txt
uv pip install -q --python .venv/bin/python -r .raster2seq/requirements-relaxed.txt plotly setuptools wheel ninja

# PyTorch 2.6 and later: tensor.type() left the dispatch macros, and torch.load loads weights
# only; the checkpoint also stores its settings as an argparse.Namespace, allowed by name.
sed -i 's/AT_DISPATCH_FLOATING_TYPES(\([a-zA-Z_]*\)\.type()/AT_DISPATCH_FLOATING_TYPES(\1.scalar_type()/g' \
  .raster2seq/models/ops/src/cuda/ms_deform_attn_cuda.cu .raster2seq/diff_ras/rasterize_cuda_kernel.cu
python3 - <<'PY'
from pathlib import Path
p = Path(".raster2seq/predict.py")
s = p.read_text()
old = '    checkpoint = torch.load(args.checkpoint, map_location="cpu")'
new = ('    with torch.serialization.safe_globals([argparse.Namespace]):\n'
       '        checkpoint = torch.load(args.checkpoint, map_location="cpu")')
if old in s:
    p.write_text(s.replace(old, new))
PY

export CUDA_HOME="${CUDA_HOME:-/opt/cuda}"
export PATH="$CUDA_HOME/bin:$PATH"
arch=$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader | head -1)
export TORCH_CUDA_ARCH_LIST="$arch" MAX_JOBS="${MAX_JOBS:-8}"
(cd .raster2seq/models/ops && ../../../.venv/bin/python setup.py -q build_ext --inplace)
(cd .raster2seq/diff_ras && ../../.venv/bin/python setup.py -q build_ext --inplace)
echo "Service and room model ready. The checkpoint downloads from Hugging Face on first use."
