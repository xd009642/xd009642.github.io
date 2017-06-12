import os
import glob
import sys
from nbconvert import HTMLExporter
import nbformat
import fnmatch

def convert_post(notebook_file):

    html_exporter = HTMLExporter()
    nb = nbformat.reads(open(notebook_file, 'r').read(), as_version=4)
    (body, resources) = html_exporter.from_notebook_node(nb)
    html_file = notebook_file.replace(".ipynb", ".html")
    html_file_writer = open(html_file, 'w')
    html_file_writer.write(body)
    html_file_writer.close()

posts = 'posts'

for root, dirs, files, in os.walk(posts):
    for filename in files: 
        if '.ipynb_checkpoints' in root:
            continue
        if filename.endswith('.ipynb'):
            convert_post(os.path.join(root, filename))
